/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  User,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import firebaseConfig from '../firebase-applet-config.json';
import { generateCarPoster, generateCarImage } from './lib/gemini';
import { 
  Car, 
  Image as ImageIcon, 
  Send, 
  History, 
  LogOut, 
  User as UserIcon, 
  Plus, 
  RefreshCw, 
  Share2, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  Camera,
  Upload,
  Copy,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';

// --- Types ---
interface UserProfile {
  uid: string;
  email: string;
  enterpriseName: string;
  phone: string;
  createdAt: string;
}

interface Poster {
  id: string;
  uid: string;
  imageUrl: string;
  content: string;
  allOptions?: string[];
  createdAt: string;
}

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
  authInfo: any;
}

// --- Helpers ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enterpriseName, setEnterpriseName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  // App states
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState<string[]>([]);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [useAIImage, setUseAIImage] = useState(false);
  const [history, setHistory] = useState<Poster[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isConfigured, setIsConfigured] = useState(true);

  // --- Auth & Profile ---
  useEffect(() => {
    // Check if config is valid
    const isPlaceholder = firebaseConfig.apiKey.includes('REPLACE_WITH');
    if (isPlaceholder) {
      setIsConfigured(false);
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // --- History Listener ---
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'posters'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const posters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Poster));
      setHistory(posters);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'posters');
    });
    return unsubscribe;
  }, [user]);

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      // Check if profile exists
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        // Create a basic profile for new Google users
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          enterpriseName: '未设置门店',
          phone: '未设置电话',
          createdAt: new Date().toISOString()
        };
        await setDoc(docRef, newProfile);
        setProfile(newProfile);
      } else {
        setProfile(docSnap.data() as UserProfile);
      }
    } catch (err: any) {
      setError('Google登录失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newProfile: UserProfile = {
          uid: userCredential.user.uid,
          email,
          enterpriseName,
          phone,
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newProfile);
        setProfile(newProfile);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Poster Logic ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt && !selectedImage && !useAIImage) {
      setError('请输入需求或上传图片');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setGeneratedOptions([]);
    setSelectedOptionIndex(null);
    
    try {
      let imageUrl = selectedImage;
      
      // 1. Generate AI Image if requested and no image uploaded
      if (useAIImage && !selectedImage && prompt) {
        imageUrl = await generateCarImage(prompt);
        setSelectedImage(imageUrl);
      }
      
      // 2. Generate Copywriting Options
      const result = await generateCarPoster(prompt, imageUrl || undefined) as { options: string[] };
      setGeneratedOptions(result.options);
      setSelectedOptionIndex(0); // Default to first option
      
      // 3. Save to History
      if (imageUrl && result.options.length > 0 && user) {
        const posterData = {
          uid: user.uid,
          imageUrl,
          content: result.options[0], // Save first option as primary content
          allOptions: result.options,
          createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, 'posters'), posterData);
        setActiveTab('generate');
      }
    } catch (err: any) {
      setError('生成失败，请重试');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyAll = () => {
    const allText = generatedOptions.join('\n\n---\n\n');
    copyToClipboard(allText);
  };

  // --- Render Helpers ---
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl border border-red-100"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="bg-red-100 p-3 rounded-xl">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">需要配置 Firebase</h1>
              <p className="text-slate-500">由于系统权限限制，无法自动为您创建项目，请手动配置。</p>
            </div>
          </div>

          <div className="space-y-6 text-slate-600">
            <div className="bg-slate-50 p-6 rounded-xl space-y-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                配置步骤：
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>访问 <a href="https://console.firebase.google.com/" target="_blank" className="text-blue-600 hover:underline">Firebase 控制台</a> 并创建一个新项目。</li>
                <li>在项目设置中添加一个 <strong>Web 应用</strong>。</li>
                <li>在 <strong>Authentication</strong> 中启用 <strong>Email/Password</strong> 和 <strong>Google</strong> 登录。</li>
                <li>在 <strong>Firestore Database</strong> 中创建一个数据库。</li>
                <li>复制 Firebase 配置对象，并将其填入项目根目录下的 <code>firebase-applet-config.json</code> 文件中。</li>
              </ol>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">您的配置文件当前内容：</p>
              <pre className="bg-slate-900 text-blue-400 p-4 rounded-lg text-xs overflow-x-auto">
                {JSON.stringify(firebaseConfig, null, 2)}
              </pre>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 mt-0.5" />
              <p className="text-sm text-blue-700">
                配置完成后，应用将自动刷新并进入登录界面。
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 p-3 rounded-xl">
              <Car className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">知车AI朋友圈</h1>
          <p className="text-slate-500 text-center mb-8">
            {authMode === 'login' ? '欢迎回来，请登录您的账号' : '开启您的AI朋友圈营销之旅'}
          </p>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">企业名称</label>
                  <input 
                    required
                    type="text" 
                    value={enterpriseName}
                    onChange={(e) => setEnterpriseName(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="例如：XX汽车服务中心"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">联系电话</label>
                  <input 
                    required
                    type="tel" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="请输入手机号"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">电子邮箱</label>
              <input 
                required
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
              <input 
                required
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (authMode === 'login' ? '登录' : '注册并开始体验')}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500">或者</span>
              </div>
            </div>

            <button 
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google 账号登录
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-blue-600 hover:underline text-sm font-medium"
            >
              {authMode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Car className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 hidden sm:block">知车AI朋友圈</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-semibold text-slate-900">{profile?.enterpriseName}</span>
              <span className="text-xs text-slate-500">{user.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Controls */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              新建发圈内容
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">描述您的需求</label>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-[120px] resize-none"
                  placeholder="例如：今天交付了一辆新款奔驰S级，感谢张总信任。或者：春季保养优惠活动..."
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-700">配图方式</label>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => { setUseAIImage(false); setSelectedImage(null); }}
                      className={cn(
                        "px-3 py-1 text-xs rounded-md transition-all",
                        !useAIImage ? "bg-white shadow-sm text-blue-600" : "text-slate-500"
                      )}
                    >
                      上传实拍
                    </button>
                    <button 
                      onClick={() => setUseAIImage(true)}
                      className={cn(
                        "px-3 py-1 text-xs rounded-md transition-all",
                        useAIImage ? "bg-white shadow-sm text-blue-600" : "text-slate-500"
                      )}
                    >
                      AI 生成
                    </button>
                  </div>
                </div>

                {!useAIImage ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all",
                      selectedImage ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                    )}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    {selectedImage ? (
                      <div className="relative w-full aspect-video rounded-lg overflow-hidden">
                        <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
                          className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-full hover:bg-black/70"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-slate-400 mb-2" />
                        <span className="text-sm text-slate-500">点击上传或拖拽图片</span>
                        <span className="text-xs text-slate-400 mt-1">AI将根据图片生成更精准的文案</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 flex flex-col items-center text-center gap-3">
                    {selectedImage && useAIImage ? (
                      <div className="relative w-full aspect-square max-w-[160px] rounded-lg overflow-hidden shadow-md">
                        <img src={selectedImage} alt="AI Generated" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ) : (
                      <div className="bg-white p-3 rounded-full shadow-sm">
                        <Sparkles className="w-6 h-6 text-blue-500" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-bold text-slate-900">AI 创意图片生成</p>
                      <p className="text-xs text-slate-500 mt-1">我们将根据您的描述，为您生成一张极具质感的汽车大片</p>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>AI正在创作中...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    <span>立即生成图文</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Stats/Info */}
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-2xl text-white shadow-lg">
            <h3 className="font-bold mb-2">💡 小贴士</h3>
            <p className="text-blue-100 text-sm leading-relaxed">
              上传到店实拍图，AI生成的文案会更具真实感和信任度哦！
            </p>
          </div>
        </div>

        {/* Right Column: Preview & History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button 
              onClick={() => setActiveTab('generate')}
              className={cn(
                "flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2",
                activeTab === 'generate' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              <ImageIcon className="w-4 h-4" />
              当前生成
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2",
                activeTab === 'history' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              <History className="w-4 h-4" />
              历史记录
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'generate' ? (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6"
              >
                {generatedOptions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-6">
                    {/* Copywriting Options */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-blue-500" />
                          AI 生成方案
                        </h3>
                        <button 
                          onClick={copyAll}
                          className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          复制全部方案
                        </button>
                      </div>
                      
                      <div className="p-4 space-y-4">
                        {generatedOptions.map((option, idx) => (
                          <div 
                            key={idx}
                            onClick={() => setSelectedOptionIndex(idx)}
                            className={cn(
                              "p-4 rounded-xl border-2 transition-all cursor-pointer relative group",
                              selectedOptionIndex === idx 
                                ? "border-blue-500 bg-blue-50/30" 
                                : "border-slate-100 hover:border-slate-200 bg-white"
                            )}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                方案 {idx + 1}
                              </span>
                              {selectedOptionIndex === idx && (
                                <CheckCircle2 className="w-4 h-4 text-blue-500" />
                              )}
                            </div>
                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                              {option}
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(option);
                              }}
                              className="absolute bottom-2 right-2 p-2 bg-white shadow-sm border border-slate-100 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-50"
                            >
                              <Copy className="w-3 h-3 text-slate-500" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
                        <button 
                          disabled={selectedOptionIndex === null}
                          onClick={() => selectedOptionIndex !== null && copyToClipboard(generatedOptions[selectedOptionIndex])}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-sm"
                        >
                          <Copy className="w-4 h-4" />
                          复制选中方案
                        </button>
                      </div>
                    </div>

                    {/* Image Preview */}
                    {selectedImage && (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">预览效果</h4>
                        <div className="relative aspect-square rounded-xl overflow-hidden shadow-inner bg-slate-100">
                          <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                    <div className="bg-slate-50 p-4 rounded-full mb-4">
                      <ImageIcon className="w-12 h-12 text-slate-300" />
                    </div>
                    <h3 className="text-slate-900 font-bold mb-2">暂无生成内容</h3>
                    <p className="text-slate-500 max-w-xs">
                      在左侧输入您的需求，AI将为您自动生成精美的图文素材。
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {history.length > 0 ? history.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-all group">
                    <div className="aspect-video relative">
                      <img src={item.imageUrl} alt="History" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button 
                          onClick={() => {
                            setGeneratedOptions(item.allOptions || [item.content]);
                            setSelectedImage(item.imageUrl);
                            setSelectedOptionIndex(0);
                            setActiveTab('generate');
                          }}
                          className="bg-white text-slate-900 px-4 py-2 rounded-lg font-bold text-sm"
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-sm text-slate-600 line-clamp-2 mb-2">{item.content}</p>
                      <p className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                )) : (
                  <div className="col-span-full bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                    <History className="w-12 h-12 text-slate-300 mb-4" />
                    <h3 className="text-slate-900 font-bold mb-2">历史记录为空</h3>
                    <p className="text-slate-500">您的每一次创作都会保存在这里。</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-slate-400 text-xs">© 2026 知车AI朋友圈 - 提升门店业绩神器</p>
        </div>
      </footer>
    </div>
  );
}
