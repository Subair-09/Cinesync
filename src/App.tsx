/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Tv, 
  Share2, 
  MessageSquare, 
  Users, 
  Calendar, 
  Clock, 
  Send, 
  Video, 
  VideoOff, 
  Mic, 
  MicOff,
  Monitor,
  X,
  Plus,
  Copy,
  Check,
  Play,
  Pause,
  Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface Message {
  type: string;
  text?: string;
  sender?: string;
  timestamp?: string;
  userId?: string;
  roomId?: string;
  signal?: any;
  from?: string;
  action?: 'play' | 'pause' | 'seek';
  time?: number;
}

interface ChatMessage {
  text: string;
  sender: string;
  timestamp: string;
  isMe: boolean;
}

interface User {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}

// --- Constants ---

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// --- App Component ---

export default function App() {
  const [view, setView] = useState<'landing' | 'join' | 'room'>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [userId] = useState(() => Math.random().toString(36).substring(7));
  const [userName, setUserName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [copied, setCopied] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  // --- WebSocket Logic ---

  const isSharingRef = useRef(isSharing);
  const userNameRef = useRef(userName);

  useEffect(() => {
    isSharingRef.current = isSharing;
  }, [isSharing]);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

  const safeSend = useCallback((data: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket is not open. State:", socketRef.current?.readyState);
    }
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;

    socket.onmessage = async (event) => {
      const data: Message = JSON.parse(event.data);

      switch (data.type) {
        case 'user-joined':
          setMessages(prev => [...prev, {
            text: `A partner joined the room!`,
            sender: 'System',
            timestamp: new Date().toLocaleTimeString(),
            isMe: false
          }]);
          // If we are sharing, we should initiate a connection to the new user
          if (isSharingRef.current) {
            initiatePeerConnection();
          }
          break;

        case 'signal':
          if (data.signal.type === 'offer') {
            await handleOffer(data.signal, data.from!);
          } else if (data.signal.type === 'answer') {
            await handleAnswer(data.signal);
          } else if (data.signal.candidate) {
            await handleCandidate(data.signal.candidate);
          }
          break;

        case 'chat':
          setMessages(prev => [...prev, {
            text: data.text!,
            sender: data.sender!,
            timestamp: new Date(data.timestamp!).toLocaleTimeString(),
            isMe: data.sender === userNameRef.current
          }]);
          break;
      }
    };

    return () => {
      socket.close();
    };
  }, []); // Empty dependency array to prevent constant reconnections

  // --- WebRTC Logic ---

  const initiatePeerConnection = async (streamToShare?: MediaStream) => {
    const stream = streamToShare || localStream;
    if (!stream) return;

    // Close existing connection if any
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    pendingCandidates.current = [];

    const pc = createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    safeSend({
      type: 'signal',
      signal: offer,
      from: userId
    });
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        safeSend({
          type: 'signal',
          signal: { candidate: event.candidate },
          from: userId
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    return pc;
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, from: string) => {
    // Close existing connection if any
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    pendingCandidates.current = [];
    
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Process buffered candidates
    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift();
      if (candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }
    
    // If we have a local stream (e.g. we are also sharing), add it
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    safeSend({
      type: 'signal',
      signal: answer,
      from: userId
    });
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) return;
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    
    // Process buffered candidates
    while (pendingCandidates.current.length > 0) {
      const candidate = pendingCandidates.current.shift();
      if (candidate) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }
  };

  const handleCandidate = async (candidate: RTCIceCandidateInit) => {
    if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidates.current.push(candidate);
    }
  };

  // --- Actions ---

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName || !roomId) return;

    safeSend({
      type: 'join',
      roomId,
      userId,
      userName
    });
    setIsJoined(true);
    setView('room');
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      setLocalStream(stream);
      setIsSharing(true);

      // Pass the stream directly to avoid waiting for state update
      initiatePeerConnection(stream);

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("Error sharing screen:", err);
    }
  };

  const stopScreenShare = () => {
    localStream?.getTracks().forEach(track => track.stop());
    setLocalStream(null);
    setIsSharing(false);
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    safeSend({
      type: 'chat',
      text: inputText,
      sender: userName
    });

    setMessages(prev => [...prev, {
      text: inputText,
      sender: userName,
      timestamp: new Date().toLocaleTimeString(),
      isMe: true
    }]);
    setInputText('');
  };

  const copyLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setUser(data);
      if (data) {
        setUserName(data.displayName);
      }
    } catch (err) {
      console.error("Error fetching user:", err);
    }
  };

  const handleGoogleLogin = async () => {
    const loginBtn = document.activeElement as HTMLButtonElement;
    if (loginBtn) loginBtn.disabled = true;

    try {
      console.log("Fetching auth URL...");
      // Try with absolute URL to avoid any relative path issues
      const apiUrl = `${window.location.origin}/api/auth/url`;
      
      let res;
      let retries = 3;
      while (retries > 0) {
        try {
          res = await fetch(apiUrl);
          if (res.ok) break;
          // If not ok, we might still want to try again if it's a 503 or something
          if (res.status >= 500) {
            console.warn(`Server error ${res.status}, retrying...`);
          } else {
            break; // 4xx errors shouldn't be retried
          }
        } catch (e) {
          console.warn("Fetch attempt failed, retrying...", e);
        }
        retries--;
        if (retries > 0) await new Promise(r => setTimeout(r, 1000));
      }

      if (!res) throw new Error("Server is unreachable after multiple attempts");

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `Server error: ${res?.status}` }));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }
      
      const data = await res.json();
      const { url } = data;
      
      if (!url) throw new Error("No auth URL returned from server");
      
      console.log("Opening auth window:", url);
      const authWindow = window.open(url, 'google_auth', 'width=600,height=700');
      
      if (!authWindow) {
        throw new Error("Popup blocked! Please allow popups for this site.");
      }
    } catch (err: any) {
      console.error("Error starting Google login:", err);
      alert(`Login failed: ${err.message || "Could not connect to server"}`);
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUserName('');
  };

  // --- Effects ---

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
        setView('join');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rId = params.get('room');
    if (rId) {
      setRoomId(rId);
      setView('join');
    }
  }, []);

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isSharing, remoteStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // --- Render Helpers ---

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-orange-500/30 overflow-x-hidden">
        {/* Background Atmosphere */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-orange-900/20 blur-[150px] rounded-full animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-orange-900/10 blur-[150px] rounded-full" />
          <div className="absolute top-[30%] right-[20%] w-[30%] h-[30%] bg-orange-600/5 blur-[120px] rounded-full" />
        </div>

        {/* Nav */}
        <nav className="relative z-50 h-20 flex items-center justify-between px-8 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-600/20 rotate-3">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold tracking-tighter text-2xl italic">CineSync</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a>
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/10">
                  <img src={user.photo} alt={user.displayName} className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                  <span className="text-white text-xs">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="text-white/40 hover:text-white transition-colors text-xs"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleLogin}
                className="bg-white/5 hover:bg-white/10 px-6 py-2.5 rounded-full border border-white/10 transition-all flex items-center gap-2"
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-4 h-4" alt="Google" />
                Login with Google
              </button>
            )}
          </div>
        </nav>

        {/* Hero Section */}
        <main className="relative z-10 pt-20 pb-32 px-6">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <h1 className="text-7xl md:text-9xl font-bold tracking-tighter mb-8 leading-[0.85] italic">
                WATCH <span className="text-orange-600">TOGETHER</span><br />
                ANYWHERE.
              </h1>
              <p className="text-xl md:text-2xl text-white/50 max-w-2xl mx-auto mb-12 font-light leading-relaxed">
                Experience movies, shows, and videos with friends in real-time. 
                High-quality screen sharing with perfectly synced audio.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                <button 
                  onClick={handleGoogleLogin}
                  className="group relative bg-orange-600 hover:bg-orange-500 text-white font-bold px-10 py-5 rounded-2xl shadow-2xl shadow-orange-600/30 transition-all active:scale-[0.98] flex items-center gap-3 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                  <Play className="w-6 h-6 fill-current" />
                  <span className="text-lg">Start Watching Now</span>
                </button>
                <button className="px-10 py-5 rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold text-lg">
                  Learn More
                </button>
              </div>
            </motion.div>

            {/* Mockup / Preview */}
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 1 }}
              className="mt-24 relative"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-orange-900 rounded-[2.5rem] blur-2xl opacity-20" />
              <div className="relative bg-[#151619] rounded-[2rem] border border-white/10 p-4 shadow-2xl">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden relative">
                  <img 
                    src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&q=80&w=2000" 
                    alt="Cinema Experience" 
                    className="w-full h-full object-cover opacity-60"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-orange-600 rounded-full flex items-center justify-center shadow-2xl animate-pulse">
                      <Play className="w-8 h-8 text-white fill-current ml-1" />
                    </div>
                  </div>
                  {/* Floating Avatars Mockup */}
                  <div className="absolute bottom-6 left-6 flex -space-x-3">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-black bg-orange-500 flex items-center justify-center text-[10px] font-bold">
                        {String.fromCharCode(64 + i)}
                      </div>
                    ))}
                    <div className="w-10 h-10 rounded-full border-2 border-black bg-white/10 backdrop-blur-md flex items-center justify-center text-[10px] font-bold">
                      +12
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </main>

        {/* Features Section */}
        <section id="features" className="relative z-10 py-32 px-6 bg-white/[0.02]">
          <div className="max-w-7xl mx-auto">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="space-y-4">
                <div className="w-12 h-12 bg-orange-600/20 rounded-2xl flex items-center justify-center mb-6">
                  <Share2 className="w-6 h-6 text-orange-500" />
                </div>
                <h3 className="text-2xl font-bold italic">Instant Sharing</h3>
                <p className="text-white/40 leading-relaxed">
                  Share your screen with a single click. No complex setup or software installation required.
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-12 h-12 bg-orange-600/20 rounded-2xl flex items-center justify-center mb-6">
                  <MessageSquare className="w-6 h-6 text-orange-500" />
                </div>
                <h3 className="text-2xl font-bold italic">Real-time Chat</h3>
                <p className="text-white/40 leading-relaxed">
                  React to every moment with your friends. Our low-latency chat keeps the conversation flowing.
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-12 h-12 bg-orange-600/20 rounded-2xl flex items-center justify-center mb-6">
                  <Users className="w-6 h-6 text-orange-500" />
                </div>
                <h3 className="text-2xl font-bold italic">Unlimited Rooms</h3>
                <p className="text-white/40 leading-relaxed">
                  Create private rooms for your inner circle or join public watch parties. The choice is yours.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="relative z-10 py-32 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-4 italic">SIMPLE <span className="text-orange-600">PRICING</span></h2>
              <p className="text-white/40 text-lg">Choose the plan that fits your watch party needs.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* Free Plan */}
              <div className="bg-white/5 border border-white/10 rounded-[2rem] p-10 flex flex-col hover:border-orange-600/50 transition-all group">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold mb-2 italic">Free Trial</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold">₦0</span>
                    <span className="text-white/40">/24h</span>
                  </div>
                </div>
                <ul className="space-y-4 mb-10 flex-1">
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    Full access for 24 hours
                  </li>
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    HD Screen Sharing
                  </li>
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    Unlimited Chat
                  </li>
                </ul>
                <button 
                  onClick={handleGoogleLogin}
                  className="w-full py-4 rounded-xl border border-white/10 hover:bg-white/5 transition-all font-bold group-hover:border-orange-600/50"
                >
                  Get Started
                </button>
              </div>

              {/* Monthly Plan */}
              <div className="relative bg-white/5 border-2 border-orange-600 rounded-[2rem] p-10 flex flex-col shadow-2xl shadow-orange-600/10">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-600 text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  Most Popular
                </div>
                <div className="mb-8">
                  <h3 className="text-2xl font-bold mb-2 italic">Monthly Pro</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold">₦3,000</span>
                    <span className="text-white/40">/month</span>
                  </div>
                </div>
                <ul className="space-y-4 mb-10 flex-1">
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    Unlimited access
                  </li>
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    4K Screen Sharing
                  </li>
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    Priority Support
                  </li>
                  <li className="flex items-center gap-3 text-white/60">
                    <Check className="w-5 h-5 text-orange-500" />
                    Custom Room IDs
                  </li>
                </ul>
                <button 
                  onClick={handleGoogleLogin}
                  className="w-full py-4 rounded-xl bg-orange-600 hover:bg-orange-500 text-white transition-all font-bold shadow-lg shadow-orange-600/20"
                >
                  Subscribe Now
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative z-10 py-12 px-6 border-t border-white/5">
          <div className="max-w-7xl mx-auto flex flex-col md:row items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                <Tv className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold tracking-tighter text-xl italic">CineSync</span>
            </div>
            <p className="text-white/20 text-xs uppercase tracking-widest font-bold">
              © 2026 CineSync. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div className="min-h-screen bg-[#0a0502] text-white flex items-center justify-center p-6 font-sans selection:bg-orange-500/30">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-900/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-900/10 blur-[120px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="flex flex-col items-center mb-12 relative">
            <button 
              onClick={() => setView('landing')}
              className="absolute left-0 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-orange-600/20 mb-6 rotate-3">
              <Tv className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-5xl font-bold tracking-tighter mb-2 italic">CineSync</h1>
            <p className="text-white/40 text-sm uppercase tracking-widest font-medium">Watch Together, Anywhere</p>
          </div>

          <form onSubmit={joinRoom} className="space-y-4 bg-white/5 p-8 rounded-3xl border border-white/10 backdrop-blur-xl">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 ml-1">Your Name</label>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-600/50 transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 ml-1">Room ID</label>
              <input 
                type="text" 
                value={roomId || ''}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter or create room ID"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-600/50 transition-all"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-4 rounded-xl shadow-xl shadow-orange-600/20 transition-all active:scale-[0.98] mt-4"
            >
              Join Session
            </button>
          </form>

          <p className="text-center mt-8 text-white/30 text-xs">
            By joining, you agree to share your screen and audio with partners in this room.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0502] text-white flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
            <Tv className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold tracking-tighter text-xl italic">CineSync</span>
          <div className="h-4 w-[1px] bg-white/10 mx-2" />
          <div className="flex items-center gap-2 text-white/40 text-xs font-medium uppercase tracking-widest">
            <Users className="w-3 h-3" />
            <span>Room: {roomId}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={copyLink}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg text-xs font-bold transition-all border border-white/5"
          >
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied!' : 'Invite Partner'}
          </button>
          <button 
            onClick={() => setShowScheduler(true)}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg text-xs font-bold transition-all border border-white/5"
          >
            <Calendar className="w-3 h-3" />
            Schedule
          </button>
          {user ? (
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
              <img src={user.photo} alt={user.displayName} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
              <span className="text-[10px] font-bold text-white/60">{user.displayName}</span>
            </div>
          ) : (
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-[10px] font-bold border border-white/20">
              {userName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 relative bg-black flex flex-col">
          <div className="flex-1 flex items-center justify-center p-4">
            {remoteStream ? (
              <div className="w-full h-full relative group">
                <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-contain rounded-2xl shadow-2xl"
                />
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                  Partner's Screen
                </div>
              </div>
            ) : isSharing ? (
              <div className="w-full h-full relative group">
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className="w-full h-full object-contain rounded-2xl shadow-2xl border-2 border-orange-600/30"
                />
                <div className="absolute top-4 left-4 bg-orange-600 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-orange-600/20">
                  Sharing Your Screen
                </div>
              </div>
            ) : (
              <div className="text-center space-y-6 max-w-md">
                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10 animate-pulse">
                  <Monitor className="w-10 h-10 text-white/20" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">No active stream</h2>
                  <p className="text-white/40 text-sm">Share your screen to start watching movies together, or wait for your partner to share theirs.</p>
                </div>
                <button 
                  onClick={startScreenShare}
                  className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-8 py-4 rounded-xl shadow-xl shadow-orange-600/20 transition-all flex items-center gap-3 mx-auto"
                >
                  <Share2 className="w-5 h-5" />
                  Start Screen Share
                </button>
                <p className="text-[10px] text-white/20 uppercase tracking-[0.2em]">Tip: Open Netflix in another tab before sharing</p>
              </div>
            )}
          </div>

          {/* Local Preview (PiP) when remote is active */}
          {isSharing && remoteStream && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute bottom-24 right-8 w-64 aspect-video bg-black rounded-xl border-2 border-orange-600 shadow-2xl overflow-hidden z-40 group"
            >
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-[10px] font-bold uppercase tracking-widest">Your Screen</span>
              </div>
            </motion.div>
          )}

          {/* Controls Overlay */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/40 backdrop-blur-2xl px-6 py-4 rounded-3xl border border-white/10 shadow-2xl">
            <button 
              onClick={isSharing ? stopScreenShare : startScreenShare}
              className={`p-4 rounded-2xl transition-all ${isSharing ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-white/10 text-white hover:bg-white/20'}`}
              title={isSharing ? "Stop Sharing" : "Share Screen"}
            >
              {isSharing ? <Monitor className="w-6 h-6" /> : <Share2 className="w-6 h-6" />}
            </button>
            <button className="p-4 rounded-2xl bg-white/10 text-white hover:bg-white/20 transition-all">
              <Mic className="w-6 h-6" />
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            <button className="p-4 rounded-2xl bg-white/10 text-white hover:bg-white/20 transition-all">
              <Volume2 className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Sidebar (Chat) */}
        <aside className="w-80 border-l border-white/5 flex flex-col bg-white/[0.02] backdrop-blur-xl">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-bold uppercase tracking-widest">Live Chat</span>
            </div>
            <span className="text-[10px] text-white/40 font-medium">{messages.length} messages</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: msg.isMe ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                    msg.sender === 'System' 
                      ? 'bg-white/5 text-white/40 italic text-xs' 
                      : msg.isMe 
                        ? 'bg-orange-600 text-white rounded-tr-none' 
                        : 'bg-white/10 text-white rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                  <div className="mt-1 flex items-center gap-2 px-1">
                    <span className="text-[9px] font-bold text-white/30 uppercase">{msg.sender}</span>
                    <span className="text-[9px] text-white/20">{msg.timestamp}</span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <form onSubmit={sendMessage} className="p-4 border-t border-white/5">
            <div className="relative">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a message..."
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-600/50 transition-all"
              />
              <button 
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-orange-500 hover:text-orange-400 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </aside>
      </main>

      {/* Scheduler Modal */}
      <AnimatePresence>
        {showScheduler && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowScheduler(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#151619] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <button 
                onClick={() => setShowScheduler(false)}
                className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-orange-600/20 rounded-2xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Schedule Watch Time</h3>
                  <p className="text-white/40 text-xs">Set a time to watch together</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 ml-1">Date & Time</label>
                  <input 
                    type="datetime-local" 
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:ring-2 focus:ring-orange-600/50 transition-all"
                  />
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <div className="flex items-center gap-3 text-orange-500 mb-2">
                    <Share2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Share Invite</span>
                  </div>
                  <p className="text-white/40 text-xs leading-relaxed mb-4">
                    Send this link to your partner. They'll see the scheduled time when they join.
                  </p>
                  <button 
                    onClick={copyLink}
                    className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Link Copied' : 'Copy Room Link'}
                  </button>
                </div>

                <button 
                  onClick={() => {
                    if (scheduledTime) {
                      safeSend({
                        type: 'chat',
                        text: `📅 Movie night scheduled for: ${new Date(scheduledTime).toLocaleString()}`,
                        sender: 'System'
                      });
                      setShowScheduler(false);
                    }
                  }}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-orange-600/20"
                >
                  Confirm Schedule
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
