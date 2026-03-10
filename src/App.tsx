/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Peer, DataConnection, MediaConnection } from 'peerjs';
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
  Volume2,
  VolumeX
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

// --- Constants ---

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

// --- App Component ---

export default function App() {
  const [roomId, setRoomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || Math.random().toString(36).substring(7);
  });
  const [isHost] = useState(() => !new URLSearchParams(window.location.search).has('room'));
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
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<'connecting' | 'open' | 'error'>('connecting');

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const mediaConnectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  useEffect(() => {
    if (localStream) {
      localStreamRef.current = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (!isJoined) return;

    const myPeerId = isHost ? roomId : userId;
    const peer = new Peer(myPeerId, {
      config: ICE_SERVERS,
      debug: 1
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setPeerStatus('open');

      // If we are a guest, connect to the host
      if (!isHost) {
        const conn = peer.connect(roomId);
        setupDataConnection(conn);
        
        conn.on('open', () => {
          conn.send({
            type: 'user-joined',
            userName,
            userId
          });
        });
      }
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setPeerStatus('error');
      if (err.type === 'peer-unavailable') {
        // This is expected if we are the first one in the room
      } else {
        setErrorMessage(`Connection error: ${err.type}`);
      }
    });

    // Handle incoming data connections (chat)
    peer.on('connection', (conn) => {
      setupDataConnection(conn);
    });

    // Handle incoming media connections (screen share)
    peer.on('call', (call) => {
      call.answer(); // Answer the call
      call.on('stream', (remoteStream) => {
        setRemoteStream(remoteStream);
      });
      mediaConnectionsRef.current.set(call.peer, call);
    });

    return () => {
      peer.destroy();
    };
  }, [userId]);

  const setupDataConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      connectionsRef.current.set(conn.peer, conn);
    });

    conn.on('data', (data: any) => {
      if (data.type === 'chat') {
        setMessages(prev => [...prev, {
          text: data.text,
          sender: data.sender,
          timestamp: new Date(data.timestamp).toLocaleTimeString(),
          isMe: false
        }]);
      } else if (data.type === 'user-joined') {
        setMessages(prev => [...prev, {
          text: `${data.userName} joined the room!`,
          sender: 'System',
          timestamp: new Date().toLocaleTimeString(),
          isMe: false
        }]);
        // If we are sharing, we should call them
        if (isSharingRef.current && localStreamRef.current) {
          const call = peerRef.current!.call(conn.peer, localStreamRef.current);
          mediaConnectionsRef.current.set(conn.peer, call);
        }
      }
    });

    conn.on('close', () => {
      connectionsRef.current.delete(conn.peer);
      mediaConnectionsRef.current.delete(conn.peer);
    });
  };

  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send(data);
      }
    });
  }, []);

  // --- Actions ---

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName || !roomId) return;

    setIsJoined(true);
  };

  const startScreenShare = async () => {
    if (peerStatus !== 'open') {
      setErrorMessage("Not connected to the signaling service. Please wait.");
      return;
    }
    setErrorMessage(null);
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (audioErr) {
        console.warn("Retrying without audio due to error:", audioErr);
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }
      
      setLocalStream(stream);
      setIsSharing(true);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Call all connected peers
      connectionsRef.current.forEach((conn, peerId) => {
        const call = peerRef.current!.call(peerId, stream);
        mediaConnectionsRef.current.set(peerId, call);
      });

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err: any) {
      console.error("Error sharing screen:", err);
      if (err.name === 'NotAllowedError') {
        setErrorMessage("Screen sharing permission was denied.");
      } else {
        setErrorMessage("An error occurred while trying to share your screen.");
      }
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  const stopScreenShare = () => {
    localStream?.getTracks().forEach(track => track.stop());
    setLocalStream(null);
    setIsSharing(false);
    mediaConnectionsRef.current.forEach(call => call.close());
    mediaConnectionsRef.current.clear();
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    broadcast({
      type: 'chat',
      text: inputText,
      sender: userName,
      timestamp: new Date().toISOString()
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

  // --- Effects ---

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = isMuted;
      remoteVideoRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  const toggleMute = () => setIsMuted(prev => !prev);
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  };

  const startRecording = () => {
    const stream = remoteStream || localStream;
    if (!stream) return;

    recordedChunksRef.current = [];
    let options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/mp4' };
      }
    }
    
    try {
      const recorder = new MediaRecorder(stream, options);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cinesync-record-${new Date().getTime()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- Render Helpers ---

  if (!isJoined) {
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
          <div className="flex flex-col items-center mb-12">
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
          <div className="h-4 w-[1px] bg-white/10 mx-2" />
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest">
            <div className={`w-2 h-2 rounded-full ${peerStatus === 'open' ? 'bg-green-500' : peerStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
            <span className={peerStatus === 'open' ? 'text-white/40' : 'text-red-400'}>
              {peerStatus === 'open' ? 'Service Ready' : peerStatus === 'connecting' ? 'Connecting Service...' : 'Service Error'}
            </span>
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
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-[10px] font-bold border border-white/20">
            {userName.charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Error Toast */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className="fixed top-20 left-1/2 z-[100] bg-red-500 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-red-400/50 backdrop-blur-md"
            >
              <X className="w-4 h-4 cursor-pointer" onClick={() => setErrorMessage(null)} />
              <span className="text-sm font-medium">{errorMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

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

          {/* Controls Overlay */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/40 backdrop-blur-2xl px-6 py-4 rounded-3xl border border-white/10 shadow-2xl">
            <button 
              onClick={isSharing ? stopScreenShare : startScreenShare}
              className={`p-4 rounded-2xl transition-all ${isSharing ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-white/10 text-white hover:bg-white/20'}`}
              title={isSharing ? "Stop Sharing" : "Share Screen"}
            >
              {isSharing ? <Monitor className="w-6 h-6" /> : <Share2 className="w-6 h-6" />}
            </button>
            <button 
              onClick={toggleMic}
              className={`p-4 rounded-2xl transition-all ${isMicMuted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
              title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            <button 
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-4 rounded-2xl transition-all relative ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-white/10 text-white hover:bg-white/20'}`}
              title={isRecording ? "Stop Recording" : "Record Session"}
            >
              <Video className="w-6 h-6" />
              {isRecording && (
                <span className="absolute -top-2 -right-2 bg-red-600 text-[8px] px-1.5 py-0.5 rounded-full border border-white/20 font-bold">
                  {formatDuration(recordingDuration)}
                </span>
              )}
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
              <button 
                onClick={toggleMute}
                className="text-white/60 hover:text-white transition-colors"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={volume} 
                onChange={handleVolumeChange}
                className="w-24 accent-orange-600 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            </div>
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
                      const text = `📅 Movie night scheduled for: ${new Date(scheduledTime).toLocaleString()}`;
                      broadcast({
                        type: 'chat',
                        text,
                        sender: 'System',
                        timestamp: new Date().toISOString()
                      });
                      setMessages(prev => [...prev, {
                        text,
                        sender: 'System',
                        timestamp: new Date().toLocaleTimeString(),
                        isMe: true
                      }]);
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
