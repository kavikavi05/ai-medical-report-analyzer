/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  FileText, 
  Upload, 
  AlertCircle, 
  CheckCircle2, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  Loader2,
  Stethoscope,
  ShieldAlert,
  Info,
  LogIn,
  LogOut,
  User,
  History,
  Trash2,
  ChevronRight,
  Plus,
  Mail,
  Lock,
  ArrowRight,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { AnalysisResult, MedicalTest, SavedAnalysis } from './types';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  doc,
  setDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-rose-100 text-center">
            <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Something went wrong</h2>
            <p className="text-slate-600 mb-6">
              We encountered an error. Please try refreshing the page.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [user, setUser] = React.useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [analysisStep, setAnalysisStep] = React.useState(0);
  const [result, setResult] = React.useState<AnalysisResult | null>(null);
  const [history, setHistory] = React.useState<SavedAnalysis[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'analyze' | 'history'>('analyze');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Login/Signup state
  const [isLoginTab, setIsLoginTab] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  // Auth Listener
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Connection Test
  React.useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // History Listener
  React.useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'analyses'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const analyses = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedAnalysis[];
      
      // Sort in memory to avoid composite index requirement
      const sortedAnalyses = analyses.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setHistory(sortedAnalyses);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'analyses');
    });

    return () => unsubscribe();
  }, [user]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;
      
      // Save user profile to Firestore
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        createdAt: new Date().toISOString()
      }, { merge: true });
      
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === 'auth/operation-not-allowed') {
        setError("Google sign-in is not enabled in the Firebase Console.");
      } else {
        setError("Failed to sign in with Google. Please try again.");
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    setAuthLoading(true);
    setError(null);
    try {
      if (isLoginTab) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        if (displayName) {
          await updateProfile(user, { displayName });
        }

        // Save user profile to Firestore
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: displayName || user.displayName,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      if (err.code === 'auth/operation-not-allowed') {
        setError("Email/Password sign-in is not enabled in the Firebase Console.");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("This email is already registered. Please sign in instead.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else {
        setError("Authentication failed. Please try again.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('analyze');
      setResult(null);
      setFile(null);
    } catch (err: any) {
      console.error("Logout error:", err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

    if (selectedFile) {
      if (!allowedTypes.includes(selectedFile.type)) {
        setError('Please upload a valid PDF or image file (PNG, JPEG).');
        setFile(null);
        return;
      }

      setFile(selectedFile);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const analyzeReport = async () => {
    if (!file || !user) return;

    setIsAnalyzing(true);
    setAnalysisStep(0);
    setError(null);
    setResult(null);

    const steps = [
      "Scanning document structure...",
      "Extracting medical test results...",
      "AI cross-referencing standards...",
      "Generating plain-language summary...",
      "Finalizing your report..."
    ];

    try {
      // Start progress simulation
      const progressInterval = setInterval(() => {
        setAnalysisStep(prev => (prev < steps.length - 1 ? prev + 1 : prev));
      }, 2500);

      const base64Data = await fileToBase64(file);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data,
                },
              },
              {
                text: "Analyze this medical report. Extract all test results, their values, normal ranges, and status. Provide a plain-language explanation for each test and a concise overall summary. Return the data in a structured JSON format.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tests: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Name of the medical test (e.g., Hemoglobin, Glucose)" },
                    value: { type: Type.STRING, description: "The measured value with units" },
                    normal_range: { type: Type.STRING, description: "The reference/normal range provided in the report" },
                    status: { 
                      type: Type.STRING, 
                      enum: ["Normal", "High", "Low", "Abnormal", "Unknown"],
                      description: "The status of the result relative to the normal range" 
                    },
                    explanation: { type: Type.STRING, description: "A brief, easy-to-understand explanation of what this test measures and what the result might mean" }
                  },
                  required: ["name", "value", "normal_range", "status", "explanation"]
                }
              },
              summary: { type: Type.STRING, description: "A concise summary of the overall report findings" },
              recommendations: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "General health recommendations or follow-up suggestions (always include a disclaimer to consult a doctor)" 
              }
            },
            required: ["tests", "summary"]
          },
          systemInstruction: "You are a highly accurate medical report analyzer. Your goal is to help patients understand their lab results by extracting data and providing clear, empathetic, and medically sound explanations. Always maintain a professional yet approachable tone. Do not diagnose; instead, explain what the numbers mean in the context of standard reference ranges. Always emphasize that the user should consult their healthcare provider for a definitive interpretation.",
        },
      });

      clearInterval(progressInterval);
      setAnalysisStep(steps.length - 1);

      const text = response.text;
      if (text) {
        const parsedResult = JSON.parse(text) as AnalysisResult;
        setResult(parsedResult);

        // Save to Firestore
        try {
          await addDoc(collection(db, 'analyses'), {
            uid: user.uid,
            fileName: file.name,
            summary: parsedResult.summary,
            tests: parsedResult.tests,
            recommendations: parsedResult.recommendations || [],
            createdAt: new Date().toISOString()
          });
        } catch (dbErr) {
          handleFirestoreError(dbErr, OperationType.CREATE, 'analyses');
        }

      } else {
        throw new Error("No analysis received from the AI.");
      }
    } catch (err: any) {
      console.error("Analysis error:", err);
      setError(err.message || "An error occurred during analysis. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteAnalysis = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this analysis?")) return;
    try {
      await deleteDoc(doc(db, 'analyses', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `analyses/${id}`);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Normal': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'High': return <ArrowUpCircle className="w-5 h-5 text-rose-500" />;
      case 'Low': return <ArrowDownCircle className="w-5 h-5 text-amber-500" />;
      case 'Abnormal': return <AlertCircle className="w-5 h-5 text-rose-500" />;
      default: return <Info className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Normal': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'High': return 'bg-rose-50 text-rose-700 border-rose-100';
      case 'Low': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'Abnormal': return 'bg-rose-50 text-rose-700 border-rose-100';
      default: return 'bg-slate-50 text-slate-700 border-slate-100';
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-blue-500 to-indigo-600 p-6 selection:bg-white/30 selection:text-white">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full backdrop-blur-xl bg-white/10 rounded-[2.5rem] shadow-[0_8px_32px_0_rgba(31,38,135,0.37)] border border-white/20 overflow-hidden"
        >
          {/* Tabs */}
          <div className="flex border-b border-white/10">
            <button
              onClick={() => { setIsLoginTab(true); setError(null); }}
              className={cn(
                "w-1/2 py-5 text-sm font-bold transition-all",
                isLoginTab ? "text-white border-b-2 border-white bg-white/10" : "text-white/40 hover:text-white/60"
              )}
            >
              Sign In
            </button>
            <button
              onClick={() => { setIsLoginTab(false); setError(null); }}
              className={cn(
                "w-1/2 py-5 text-sm font-bold transition-all",
                !isLoginTab ? "text-white border-b-2 border-white bg-white/10" : "text-white/40 hover:text-white/60"
              )}
            >
              Create Account
            </button>
          </div>

          <div className="p-10">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-indigo-600 shadow-xl shadow-black/10">
                <Stethoscope className="w-8 h-8" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white text-center mb-2">
              {isLoginTab ? "Welcome Back 👋" : "Join MedAI"}
            </h2>
            <p className="text-white/70 text-center mb-8 text-sm">
              {isLoginTab ? "Login to continue your analysis." : "Sign up to start tracking your health reports."}
            </p>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {!isLoginTab && (
                <div className="relative">
                  <User className="w-5 h-5 text-white/50 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Full Name"
                    required
                    className="w-full pl-12 pr-4 py-4 bg-white/10 border border-white/10 rounded-2xl outline-none focus:ring-2 focus:ring-white/20 focus:bg-white/20 transition-all text-white placeholder:text-white/40"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="w-5 h-5 text-white/50 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  placeholder="Email Address"
                  required
                  className="w-full pl-12 pr-4 py-4 bg-white/10 border border-white/10 rounded-2xl outline-none focus:ring-2 focus:ring-white/20 focus:bg-white/20 transition-all text-white placeholder:text-white/40"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="relative">
                <Lock className="w-5 h-5 text-white/50 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  required
                  className="w-full pl-12 pr-12 py-4 bg-white/10 border border-white/10 rounded-2xl outline-none focus:ring-2 focus:ring-white/20 focus:bg-white/20 transition-all text-white placeholder:text-white/40"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-rose-500/20 border border-rose-500/30 rounded-xl flex items-center gap-3 text-rose-200 text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-white/90 transition-all active:scale-[0.98] shadow-lg shadow-black/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {authLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                  <>
                    {isLoginTab ? "Login" : "Sign Up"}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-transparent px-4 text-white/40 font-bold tracking-widest">Or continue with</span>
              </div>
            </div>

            <button 
              onClick={handleGoogleLogin}
              className="w-full py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.98]"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              Google
            </button>

            <p className="mt-8 text-[10px] text-white/40 text-center font-medium uppercase tracking-widest leading-relaxed">
              By continuing, you agree to our <br />
              <span className="text-white/60 underline cursor-pointer">Terms of Service</span> & <span className="text-white/60 underline cursor-pointer">Privacy Policy</span>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0f172a] text-white flex flex-col sticky top-0 h-screen p-6 shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Stethoscope className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">MedAI</h1>
        </div>

        <nav className="flex flex-col gap-2 flex-1">
          <button 
            onClick={() => {
              setView('analyze');
              setResult(null);
              setFile(null);
            }}
            className={cn(
              "px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-3",
              view === 'analyze' ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <Plus className="w-5 h-5" />
            New Analysis
          </button>
          <button 
            onClick={() => setView('history')}
            className={cn(
              "px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-3",
              view === 'history' ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" : "text-slate-400 hover:text-white hover:bg-slate-800"
            )}
          >
            <History className="w-5 h-5" />
            History
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-800 space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
              {user.displayName?.[0] || 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{user.displayName}</p>
              <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all flex items-center gap-3"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-12">
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {view === 'analyze' ? (
              <motion.div 
                key="analyze-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-12"
              >
                {/* Left Column: Upload & Info */}
                <div className="lg:col-span-5 space-y-8">
                  <section className="space-y-4">
                    <h2 className="text-3xl font-bold text-slate-900 leading-tight">
                      Understand your lab results in seconds.
                    </h2>
                    <p className="text-lg text-slate-600 leading-relaxed">
                      Upload your blood tests or medical reports as a PDF or image. Our AI extracts the data and explains what it means for your health.
                    </p>
                  </section>

                <div className="space-y-4">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 p-10 text-center",
                      file ? "border-blue-400 bg-blue-50/30" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                    )}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="application/pdf,image/png,image/jpeg"
                      className="hidden"
                    />
                    <div className="flex flex-col items-center gap-4">
                      <div className={cn(
                        "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors duration-300",
                        file ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-600"
                      )}>
                        {file ? <FileText className="w-8 h-8" /> : <Upload className="w-8 h-8" />}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">
                          {file ? file.name : "Click to upload report"}
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                          PDF or Image
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={analyzeReport}
                    disabled={!file || isAnalyzing}
                    className={cn(
                      "w-full py-4 px-6 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-xl shadow-blue-100",
                      !file || isAnalyzing 
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                        : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]"
                    )}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Analyzing Report...
                      </>
                    ) : (
                      <>
                        Analyze Report
                      </>
                    )}
                  </button>

                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex gap-3 text-rose-700"
                    >
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="text-sm font-medium">{error}</p>
                    </motion.div>
                  )}
                </div>

                <div className="p-6 bg-slate-100 rounded-2xl border border-slate-200">
                  <h3 className="font-bold flex items-center gap-2 mb-3 text-slate-700">
                    <ShieldAlert className="w-5 h-5" />
                    Medical Disclaimer
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    This tool is for informational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition.
                  </p>
                </div>
              </div>

              {/* Right Column: Results */}
              <div className="lg:col-span-7">
                <AnimatePresence mode="wait">
                  {result ? (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-8"
                    >
                      {/* Summary Card */}
                      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h3 className="text-2xl font-bold mb-4">Analysis Summary</h3>
                        <p className="text-slate-600 leading-relaxed text-lg">
                          {result.summary}
                        </p>
                      </div>

                      {/* Tests List */}
                      <div className="space-y-4">
                        <h3 className="text-xl font-bold px-2">Detailed Results</h3>
                        <div className="space-y-4">
                          {result.tests.map((test, index) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-blue-200 transition-colors"
                            >
                              <div className="p-6">
                                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                                  <div>
                                    <h4 className="text-lg font-bold text-slate-900">{test.name}</h4>
                                    <div className="flex items-center gap-4 mt-1">
                                      <p className="text-sm text-slate-500">
                                        Result: <span className="font-bold text-slate-900">{test.value}</span>
                                      </p>
                                      <p className="text-sm text-slate-500">
                                        Range: <span className="font-medium text-slate-700">{test.normal_range}</span>
                                      </p>
                                    </div>
                                  </div>
                                  <div className={cn(
                                    "px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-1.5",
                                    getStatusColor(test.status)
                                  )}>
                                    {getStatusIcon(test.status)}
                                    {test.status}
                                  </div>
                                </div>
                                <div className="pt-4 border-t border-slate-100">
                                  <p className="text-sm text-slate-600 leading-relaxed italic">
                                    "{test.explanation}"
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      {/* Recommendations */}
                      {result.recommendations && result.recommendations.length > 0 && (
                        <div className="bg-blue-600 rounded-3xl p-8 text-white shadow-xl shadow-blue-200">
                          <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                            <CheckCircle2 className="w-8 h-8" />
                            Next Steps
                          </h3>
                          <ul className="space-y-4">
                            {result.recommendations.map((rec, index) => (
                              <li key={index} className="flex gap-3 text-blue-50">
                                <div className="w-6 h-6 rounded-full bg-blue-500/50 flex items-center justify-center shrink-0 text-xs font-bold">
                                  {index + 1}
                                </div>
                                <p className="font-medium">{rec}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  ) : isAnalyzing ? (
                    <div key="loading" className="h-full min-h-[500px] flex flex-col items-center justify-center p-8">
                      <div className="w-full max-w-md space-y-10">
                        {/* Animated Icon */}
                        <div className="flex justify-center">
                          <div className="relative">
                            <motion.div 
                              animate={{ 
                                scale: [1, 1.1, 1],
                                opacity: [0.5, 1, 0.5]
                              }}
                              transition={{ duration: 2, repeat: Infinity }}
                              className="absolute inset-0 bg-blue-400 blur-2xl rounded-full"
                            />
                            <div className="relative w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-blue-500/40">
                              <Stethoscope className="w-12 h-12" />
                            </div>
                          </div>
                        </div>

                        {/* Title & Progress */}
                        <div className="text-center space-y-3">
                          <h3 className="text-2xl font-bold text-slate-900">Processing Report</h3>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: "0%" }}
                              animate={{ width: `${((analysisStep + 1) / 5) * 100}%` }}
                              className="h-full bg-blue-600"
                            />
                          </div>
                        </div>

                        {/* Process Outline */}
                        <div className="space-y-4">
                          {[
                            "Scanning document structure...",
                            "Extracting medical test results...",
                            "AI cross-referencing standards...",
                            "Generating plain-language summary...",
                            "Finalizing your report..."
                          ].map((step, idx) => (
                            <motion.div 
                              key={idx}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ 
                                opacity: idx <= analysisStep ? 1 : 0.3,
                                x: 0,
                                color: idx === analysisStep ? "#2563eb" : "#64748b"
                              }}
                              className="flex items-center gap-4 text-sm font-medium"
                            >
                              <div className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-500",
                                idx < analysisStep ? "bg-green-100 text-green-600" : 
                                idx === analysisStep ? "bg-blue-600 text-white animate-pulse" : 
                                "bg-slate-100 text-slate-400"
                              )}>
                                {idx < analysisStep ? (
                                  <CheckCircle2 className="w-4 h-4" />
                                ) : (
                                  <span className="text-[10px]">{idx + 1}</span>
                                )}
                              </div>
                              <span className={cn(
                                "transition-all duration-500",
                                idx === analysisStep ? "text-blue-600 font-bold" : ""
                              )}>
                                {step}
                              </span>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key="empty" className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-slate-200 rounded-[2.5rem] bg-slate-50/50">
                      <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center text-slate-300 mb-6 shadow-sm">
                        <FileText className="w-10 h-10" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-400">No report analyzed yet</h3>
                      <p className="text-slate-400 mt-2 max-w-xs">
                        Upload a PDF or image report on the left to see the detailed analysis here.
                      </p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="history-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-slate-900">Analysis History</h2>
                  <p className="text-slate-500 mt-1">Review your past medical report analyses</p>
                </div>
                <button 
                  onClick={() => setView('analyze')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  New Analysis
                </button>
              </div>

              {history.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {history.map((item) => (
                    <motion.div
                      key={item.id}
                      layoutId={item.id}
                      onClick={() => {
                        setResult(item);
                        setView('analyze');
                      }}
                      className="bg-white rounded-3xl p-6 border border-slate-200 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-50 transition-all cursor-pointer group relative"
                    >
                      <button 
                        onClick={(e) => deleteAnalysis(item.id, e)}
                        className="absolute top-4 right-4 p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-4">
                        <FileText className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-slate-900 mb-1 truncate pr-8">{item.fileName}</h3>
                      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-4">
                        {new Date(item.createdAt).toLocaleDateString(undefined, { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </p>
                      <p className="text-sm text-slate-600 line-clamp-3 mb-6">
                        {item.summary}
                      </p>
                      <div className="flex items-center justify-between text-blue-600 font-bold text-sm">
                        <span>{item.tests.length} Tests Extracted</span>
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-white rounded-[3rem] border border-slate-200">
                  <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-200 mx-auto mb-6">
                    <History className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-400">No history found</h3>
                  <p className="text-slate-400 mt-2">Your analyzed reports will appear here.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
