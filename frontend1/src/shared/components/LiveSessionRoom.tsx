import React, { useState, useEffect, useRef } from 'react';
import { InterpretationSession, InterpretationRequest, User } from '../types';
import { api } from '../api';
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  ConnectionState,
} from 'livekit-client';import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  PhoneCall,
  Signal,
  Wifi,
  Shield,
  Clock,
  Volume2,
  BookOpen,
  Radio,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Send,
  MessageSquare,
  Users,
  Maximize2,
  Minimize2,
  X,
  XCircle,
} from 'lucide-react';

interface ChatMessageItem {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

interface LiveSessionRoomProps {
  session: InterpretationSession;
  currentUser: User;
  onEndSession: (sessionId: string, declined?: boolean) => Promise<void>;
  onClose: () => void;
  onCallFinished?: (sessionId: string, status?: string) => void;
  onOpenCompletionModal: (sessionId: string) => void;
  onTakeWaitingCall?: (reference: string) => Promise<void>;
  pendingCompletionSessionIds?: string[];
  onOpenPendingCompletion?: (sessionId: string) => void;
}

export const LiveSessionRoom: React.FC<LiveSessionRoomProps> = ({
  session,
  currentUser,
  onEndSession,
  onClose,
  onCallFinished,
  onOpenCompletionModal,
  onTakeWaitingCall,
  pendingCompletionSessionIds = [],
  onOpenPendingCompletion,
}) => {
  const isVideoMode = session.communicationMode === 'video';

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(!isVideoMode);
  const [isLowBandwidth, setIsLowBandwidth] = useState(session.lowBandwidthMode);
  const [duration, setDuration] = useState(session.durationSeconds || 0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [showTerminology, setShowTerminology] = useState(false);
  const [endingCall, setEndingCall] = useState(false);

  // LiveKit Connection States (credentials come from server .env â€” no UI config)
  const [connectionState, setConnectionState] = useState<string>('initializing');
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  // Web Audio mic activity level (0-100)
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState<number>(0);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState<boolean>(false);
  const [remoteIsMuted, setRemoteIsMuted] = useState<boolean>(false);
  const [waitingCalls, setWaitingCalls] = useState<InterpretationRequest[]>([]);
  const [clearedWaitingRefs, setClearedWaitingRefs] = useState<string[]>([]);
  const [takingCall, setTakingCall] = useState<string | null>(null);
  // Live countdown ticker — increments every second to force sidebar re-renders
  const [tick, setTick] = useState(0);
  // Right-side Live Session Chat (open by default on desktop, toggled via Chat button on mobile)
  const [showRightPanel, setShowRightPanel] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  const [chatWidth, setChatWidth] = useState<'narrow' | 'normal' | 'wide'>('normal');
  const [rightTab, setRightTab] = useState<'chat' | 'participants'>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Streams & Room Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Timer + heartbeat (Eliotel-style presence while the call is open)
  useEffect(() => {
    const timer = setInterval(() => {
      setDuration((prev) => {
        const next = prev + 1;
        if (next % 5 === 0) {
          api
            .sendHeartbeat(session.id, connectionState === 'connected' ? 'optimal' : 'fair', next)
            .catch(() => undefined);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session.id, connectionState]);

  // 1-second ticker to drive waiting-calls countdown display
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll waiting calls (interpreters only) -- stops when ending the call.
  // Poll every 2 seconds so new calls appear quickly during an active session.
  useEffect(() => {
    if (currentUser.role !== 'interpreter' || endingCall) return;
    const fetchWaiting = async () => {
      try {
        const res = await api.getWaitingCalls();
        setWaitingCalls(res.waitingCalls || []);
      } catch {
        // ignore transient errors
      }
    };
    fetchWaiting();
    const timer = setInterval(fetchWaiting, 2000);
    return () => clearInterval(timer);
  }, [currentUser.role]);

  const handleTakeCall = async (reference: string) => {
    setTakingCall(reference);
    try {
      // Disconnect current room before switching
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      await onTakeWaitingCall?.(reference);
    } catch (e: any) {
      console.warn('Failed to take waiting call:', e);
      setTakingCall(null);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const attachLocalPreview = (room: Room) => {
    const pubs = Array.from(room.localParticipant.trackPublications.values());
    const stream = new MediaStream();
    for (const pub of pubs) {
      const track = pub.track;
      if (!track) continue;
      const media = track.mediaStreamTrack;
      if (media) stream.addTrack(media);
    }
    if (stream.getTracks().length) {
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      try {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
              audioContextRef.current.close().catch(() => {});
            }
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            const source = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.5;
            source.connect(analyser);
            analyserRef.current = analyser;
            const buffer = new Uint8Array(analyser.frequencyBinCount);
            const checkVolume = () => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(buffer);
              let sum = 0;
              for (let i = 0; i < buffer.length; i++) sum += buffer[i];
              setAudioLevel(Math.min(100, Math.round((sum / buffer.length / 60) * 100)));
              animFrameRef.current = requestAnimationFrame(checkVolume);
            };
            checkVolume();
          }
        }
      } catch (audioErr) {
        console.warn('Audio metering fallback:', audioErr);
      }
    }
  };

  // Eliotel-style join flow on LiveKit: authorize â†’ token â†’ connect shared room â†’ publish
  useEffect(() => {
    let active = true;

    async function joinCall() {
      try {
        setConnectionState('connecting');
        setConnectionNotice('Joining secure interpretation room...');

        // 1) Mark participant joined (session â†’ active / request â†’ in_session)
        try {
          const token =
            session.sessionToken && !session.sessionToken.startsWith('SES-LIVE')
              ? session.sessionToken
              : undefined;
          await api.joinSession(session.id, token);
        } catch (joinErr: any) {
          console.warn('Session join notice:', joinErr?.message || joinErr);
        }
        if (!active) return;

        // 2) Mint LiveKit token for the shared call room (orzo-<requestReference>)
        const tokenRes = await api.getLiveKitToken(session.id);
        if (!active) return;

        console.info('[LiveSessionRoom] shared call room:', tokenRes.room, 'session:', session.id);

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: isLowBandwidth
            ? { resolution: { width: 640, height: 360, frameRate: 15 } }
            : { resolution: { width: 1280, height: 720, frameRate: 24 } },
        });
        roomRef.current = room;

        room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (!active) return;
          if (state === ConnectionState.Connected) {
            setConnectionState('connected');
            setConnectionNotice(null);
          } else if (state === ConnectionState.Connecting) {
            setConnectionState('connecting');
          } else if (state === ConnectionState.Reconnecting) {
            setConnectionState('reconnecting');
            setConnectionNotice('Reconnecting to the call room...');
          } else if (state === ConnectionState.Disconnected) {
            setConnectionState('disconnected');
          }
        });

        const attachRemoteTrack = (track: RemoteTrack, participant: RemoteParticipant) => {
          setRemoteParticipantName(participant.name || participant.identity);
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
            setHasRemoteVideo(true);
            void remoteVideoRef.current.play?.().catch(() => undefined);
          } else if (track.kind === Track.Kind.Audio) {
            if (remoteAudioRef.current) {
              track.attach(remoteAudioRef.current);
              remoteAudioRef.current.muted = false;
              remoteAudioRef.current.volume = 1;
              void remoteAudioRef.current.play().catch(() => {
                // Browser autoplay policy blocked playback â€” user must click to enable.
                setAudioBlocked(true);
              });
            } else {
              // Fallback: LiveKit can create/attach its own audio element
              track.attach();
            }
            setRemoteAudioLevel(70);
          }
        };

        const bindExistingRemoteTracks = () => {
          room.remoteParticipants.forEach((participant) => {
            setRemoteParticipantName(participant.name || participant.identity);
            participant.trackPublications.forEach((publication: RemoteTrackPublication) => {
              if (!publication.isSubscribed) {
                try {
                  publication.setSubscribed(true);
                } catch {
                  // Older clients may not expose setSubscribed.
                }
              }
              if (publication.track) {
                attachRemoteTrack(publication.track, participant);
              }
            });
          });
        };

        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (!active) return;
            attachRemoteTrack(track, participant);
          }
        );

        room.on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
          if (!active) return;
          try {
            publication.setSubscribed(true);
          } catch {
            // ignore
          }
          if (publication.track) attachRemoteTrack(publication.track, participant);
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach();
          if (track.kind === Track.Kind.Video) setHasRemoteVideo(false);
          if (track.kind === Track.Kind.Audio) {
            setRemoteAudioLevel(0);
            setRemoteIsMuted(true);
          }
        });

        // Remote mute/unmute detection
        room.on(RoomEvent.TrackMuted, (publication, participant) => {
          if (!active) return;
          if (participant instanceof RemoteParticipant && publication.kind === Track.Kind.Audio) {
            setRemoteIsMuted(true);
          }
        });
        room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
          if (!active) return;
          if (participant instanceof RemoteParticipant && publication.kind === Track.Kind.Audio) {
            setRemoteIsMuted(false);
          }
        });

        room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          setRemoteParticipantName(participant.name || participant.identity);
          setConnectionNotice(null);
          // Check initial mute state
          participant.trackPublications.forEach((publication) => {
            if (publication.kind === Track.Kind.Audio && publication.isMuted) {
              setRemoteIsMuted(true);
            }
            if (publication.track) attachRemoteTrack(publication.track, participant);
          });
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          setRemoteParticipantName(null);
          setHasRemoteVideo(false);
          setRemoteAudioLevel(0);
          setRemoteIsMuted(false);
        });

        room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
          if (!active) return;
          try {
            const decoded = JSON.parse(new TextDecoder().decode(payload));
            if (decoded?.type === 'chat' && decoded?.text) {
              setChatMessages((prev) => [
                ...prev,
                {
                  id: decoded.id || `${Date.now()}-${Math.random()}`,
                  senderId: decoded.senderId || participant?.identity || 'remote',
                  senderName: decoded.senderName || participant?.name || 'Participant',
                  text: String(decoded.text),
                  timestamp: decoded.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
              ]);
              setUnreadChat((c) => c + 1);
            }
          } catch {
            // ignore non-chat data packets
          }
        });
        await room.connect(tokenRes.url, tokenRes.token, { autoSubscribe: true });
        if (!active) return;

        setConnectionState('connected');
        setConnectionNotice(null);

        // Bind tracks already in the room (second joiner / reconnect).
        bindExistingRemoteTracks();

        // 3) Publish local AV through LiveKit (single capture path â€” no double getUserMedia)
        try {
          if (isVideoMode) {
            await room.localParticipant.setMicrophoneEnabled(true);
            await room.localParticipant.setCameraEnabled(true);
            setIsVideoOff(false);
          } else {
            await room.localParticipant.setMicrophoneEnabled(true);
            await room.localParticipant.setCameraEnabled(false);
            setIsVideoOff(true);
          }
        } catch (mediaErr: any) {
          console.warn('Local media publish error:', mediaErr);
          setConnectionNotice(
            mediaErr?.message ||
              'Microphone/camera permission is required. Allow access and rejoin the call.',
          );
        }
        if (!active) return;
        attachLocalPreview(room);
        // Re-bind remotes after publish settles (some SFUs delay TrackSubscribed).
        window.setTimeout(() => {
          if (active && roomRef.current === room) bindExistingRemoteTracks();
        }, 800);
      } catch (err: any) {
        if (!active) return;
        console.warn('LiveKit join error:', err);
        setConnectionState('error');
        setConnectionNotice(err?.message || 'Failed to join the LiveKit call room.');
      }
    }

    joinCall();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      localStreamRef.current = null;
    };
  }, [session.id, session.sessionToken, isVideoMode, isLowBandwidth]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onCallFinishedRef = useRef(onCallFinished);
  onCallFinishedRef.current = onCallFinished;

  const leaveBecauseCallEnded = (status?: string) => {
    roomRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (onCallFinishedRef.current) onCallFinishedRef.current(session.id, status);
    else onCloseRef.current();
  };

  useEffect(() => {
    let stopped = false;
    const watch = async () => {
      try {
        const res = await api.getSession(session.id);
        if (stopped || !['completed', 'cancelled', 'expired'].includes(res.session.status)) return;
        stopped = true;
        leaveBecauseCallEnded(res.session.status);
      } catch {
        // A missed status check should not drop a live call.
      }
    };
    const timer = window.setInterval(watch, 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [session.id]);

  // Toggle Mute â€” LiveKit local participant is the source of truth
  const handleToggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (roomRef.current?.localParticipant) {
      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
      } catch (e) {
        console.warn('LiveKit mute toggle:', e);
      }
    }
  };

  // Toggle Video â€” publish/unpublish via LiveKit only.
  // Works in both audio and video modes so participants can turn on
  // their camera mid-call.
  const handleToggleVideo = async () => {
    const nextVideoOff = !isVideoOff;
    setIsVideoOff(nextVideoOff);
    try {
      if (roomRef.current?.localParticipant) {
        await roomRef.current.localParticipant.setCameraEnabled(!nextVideoOff);
        attachLocalPreview(roomRef.current);
      }
    } catch (e: any) {
      console.warn('Camera toggle error:', e);
      setIsVideoOff(true);
      setConnectionNotice(e?.message || 'Camera permission required for video call.');
    }
  };

  // Enable audio â€” called from a user click to satisfy browser autoplay policy
  const handleEnableAudio = async () => {
    try {
      if (remoteAudioRef.current) {
        await remoteAudioRef.current.play();
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1;
      }
      setAudioBlocked(false);
    } catch {
      // Still blocked â€” user may need to click again
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Poll backend session chat so messages work reliably on both client & interpreter sides
  useEffect(() => {
    let stopped = false;
    const syncChat = async () => {
      try {
        const res = await api.getSessionChat(session.id);
        if (stopped || !res.messages) return;
        setChatMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          let addedRemote = 0;
          for (const m of res.messages) {
            if (!byId.has(m.id)) {
              byId.set(m.id, m);
              if (m.senderId !== currentUser.id) addedRemote++;
            }
          }
          if (addedRemote > 0) {
            setUnreadChat((c) => c + addedRemote);
          }
          return Array.from(byId.values());
        });
      } catch {
        // ignore transient poll errors
      }
    };
    syncChat();
    const timer = window.setInterval(syncChat, 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [session.id, currentUser.id]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    const msg: ChatMessageItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: currentUser.id,
      senderName: currentUser.fullName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatInput('');
    api.sendSessionChat(session.id, { id: msg.id, text: msg.text, timestamp: msg.timestamp }).catch(() => undefined);
    try {
      if (roomRef.current?.localParticipant) {
        const bytes = new TextEncoder().encode(JSON.stringify({ type: 'chat', ...msg }));
        await roomRef.current.localParticipant.publishData(bytes, { reliable: true });
      }
    } catch {
      // backend sync already handles delivery
    }
  };

  // End Call or Decline Call — disconnect media first, then notify backend.
  const handleEndCall = async (declined = false) => {
    if (endingCall) return;
    setEndingCall(true);
    setWaitingCalls([]);

    // 1. Immediately stop local media and disconnect LiveKit room so the user's
    //    mic/camera stops regardless of what happens next.
    try {
      roomRef.current?.disconnect();
    } catch { /* ignore */ }
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }

    // 2. Tell the backend the session ended or was declined.
    try {
      await onEndSession(session.id, declined);
    } catch (err: any) {
      console.warn('End-session API call failed (session will be cleaned up by poll):', err?.message ?? err);
    }

    // 3. Exit the room UI.
    // The person who clicked Decline exits cleanly without seeing the "Call Declined" card.
    if (declined) {
      onClose();
    } else if (currentUser.role === 'interpreter') {
      onOpenCompletionModal(session.id);
    } else if (onCallFinished) {
      onCallFinished(session.id, 'completed');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#f4f7f9] text-slate-900 flex flex-col overflow-hidden select-none">
      {/* Remote Audio Track (Hidden) — must autoplay + playsInline for mobile/desktop */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Audio enable overlay — browser autoplay policy requires a user gesture */}
      {audioBlocked && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm text-white">
          <div className="text-center space-y-4 px-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-400/40">
              <Volume2 className="w-8 h-8 text-emerald-300" />
            </div>
            <h3 className="text-lg font-bold text-white">Click to enable audio</h3>
            <p className="text-sm text-white/70 max-w-xs">
              Your browser blocked automatic audio playback for security. Click below to hear the interpreter.
            </p>
            <button
              onClick={handleEnableAudio}
              className="px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
            >
              Enable Audio
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="relative bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between z-10 shadow-xs">
        <div className="flex items-center space-x-3">
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              connectionState === 'connected'
                ? 'bg-emerald-500'
                : connectionState === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-slate-400'
            }`}
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight">
                Live Interpretation Session
              </span>
              <span className="text-xs bg-slate-100 text-slate-700 font-mono px-2.5 py-0.5 rounded-lg border border-slate-200 font-bold">
                {session.id}
              </span>
              <span className="hidden sm:inline text-xs bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-lg border border-slate-200">
                Ref: {session.requestReference}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {session.organizationName} • {session.serviceCategory.replace('_', ' ').toUpperCase()} •{' '}
              <strong className="text-blue-700">
                {session.sourceLanguage.toUpperCase()} ⇄ {session.targetLanguage.toUpperCase()}
              </strong>
            </p>
          </div>
        </div>

        {/* Center / Right stats: Pending Report, Duration & LiveKit Status */}
        <div className="flex items-center space-x-2.5">
          {currentUser.role === 'interpreter' && pendingCompletionSessionIds.length > 0 && onOpenPendingCompletion && (
            <button
              type="button"
              onClick={() => onOpenPendingCompletion(pendingCompletionSessionIds[0])}
              className="flex items-center space-x-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 px-3 py-1.5 rounded-xl font-extrabold text-xs shadow-xs cursor-pointer transition-colors"
              title={`Fill completion report for previous session ${pendingCompletionSessionIds[0]}`}
            >
              <FileCheck className="w-4 h-4 shrink-0" />
              <span>
                Report {pendingCompletionSessionIds[0]}
                {pendingCompletionSessionIds.length > 1 ? ` (+${pendingCompletionSessionIds.length - 1})` : ''}
              </span>
            </button>
          )}

          {/* Duration Pill */}
          <div className="flex items-center space-x-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 font-mono text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-bold text-slate-800">{formatTimer(duration)}</span>
          </div>

          {/* Connection status */}
          <div
            className={`hidden sm:flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-xl border ${
              connectionState === 'connected'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            title="Live media connection"
          >
            <Signal className="w-3.5 h-3.5" />
            <span className="font-bold">
              {connectionState === 'connected' ? 'Live Connected' : 'Connecting…'}
            </span>
          </div>

          {/* Security badge */}
          <div className="hidden md:flex items-center space-x-1.5 text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1.5 rounded-xl">
            <Shield className="w-3.5 h-3.5 text-slate-500" />
            <span>Encrypted · No Recording</span>
          </div>

          {/* Glossary */}
          <button
            onClick={() => setShowTerminology(!showTerminology)}
            className="p-2 text-xs bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 flex items-center space-x-1 cursor-pointer transition"
            title="Linguistic Glossary"
          >
            <BookOpen className="w-4 h-4 text-slate-500" />
            <span className="hidden lg:inline font-semibold">Glossary</span>
          </button>
        </div>
      </div>

      {/* Connection / permission notices */}
      {connectionNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center gap-2 z-10">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="truncate">{connectionNotice}</span>
        </div>
      )}

      {/* Main Workspace Body — stacked video boxes (up/down) on mobile, side-by-side on desktop */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden z-10 relative">

        {/* Left: Framed Caller & Interpreter (Up/Down on Mobile, Left/Right on Desktop) + Controls */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2.5 sm:p-4 gap-2.5 sm:gap-3">
          {/* 2-Card Video Grid: 1 col x 2 rows (up & down) on mobile, 2 cols x 1 row on md+ */}
          <div className="flex-1 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1 gap-3 min-h-0">
            {/* Top (Mobile) / Left (Desktop) Frame: Local */}
            <div className="relative bg-slate-900 rounded-2xl overflow-hidden shadow-lg border-2 border-blue-500/40 ring-1 ring-slate-200 min-h-0">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
              {isVideoOff && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-slate-900">
                  <div className="w-20 h-20 rounded-2xl bg-cyan-950/80 border border-cyan-700/50 flex items-center justify-center">
                    <UserIcon className="w-10 h-10 text-cyan-300" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300">
                    {isMuted ? <span className="text-red-400">Muted</span> : 'Camera Off'}
                  </span>
                </div>
              )}
              <div className="absolute top-3 left-3 bg-blue-600/90 backdrop-blur-sm px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white z-10">
                {currentUser.role === 'interpreter' ? 'Interpreter (You)' : 'Caller (You)'}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 z-10">
                <span className={`w-2 h-2 rounded-full ${isMuted ? 'bg-red-400' : 'bg-emerald-400'}`} />
                <span>{currentUser.fullName}</span>
                {isMuted && <MicOff className="w-3.5 h-3.5 text-red-400" />}
              </div>
            </div>

            {/* Bottom (Mobile) / Right (Desktop) Frame: Remote */}
            <div className="relative bg-slate-900 rounded-2xl overflow-hidden shadow-lg border-2 border-emerald-500/40 ring-1 ring-slate-200 min-h-0">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {!hasRemoteVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                  <div className="w-20 h-20 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
                    <Volume2 className="w-10 h-10 text-emerald-300" />
                  </div>
                  <div className="flex items-end gap-1 h-6">
                    {[0.4,0.7,1.0,0.6,0.8,0.5,0.9].map((h, i) => (
                      <span key={i} className="w-1 rounded-full bg-emerald-400 animate-bounce" style={{ height: `${Math.round(h*20)}px`, animationDelay: `${i*0.1}s`, animationDuration: '0.9s' }} />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Live Audio
                  </span>
                </div>
              )}
              <div className="absolute top-3 left-3 bg-emerald-600/90 backdrop-blur-sm px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white z-10">
                {currentUser.role === 'interpreter' ? 'Caller' : 'Interpreter'}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 z-10">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>{remoteParticipantName || (currentUser.role === 'interpreter' ? session.clientName : session.interpreterName) || 'Participant'}</span>
                {remoteIsMuted && <MicOff className="w-3.5 h-3.5 text-red-400" />}
              </div>
            </div>
          </div>

          {/* Speakerphone banner */}
          {session.communicationMode === 'phone_assisted' && (
            <div className="p-2.5 bg-cyan-50 border border-cyan-200 text-cyan-900 text-xs rounded-xl flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-600 shrink-0" />
              <span><strong>Speakerphone Mode</strong> — Active on terminal speakerphone.</span>
            </div>
          )}

          {/* Control Bar */}
          <div className="flex-shrink-0 flex justify-center">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-2.5 flex items-center justify-center gap-3 shadow-sm">
              <button onClick={handleToggleMute} className={`p-3 rounded-xl cursor-pointer transition-all ${isMuted ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`} title={isMuted ? 'Unmute' : 'Mute'}>
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button onClick={handleToggleVideo} className={`p-3 rounded-xl cursor-pointer transition-all ${isVideoOff ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`} title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}>
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <VideoIcon className="w-5 h-5" />}
              </button>
              <button onClick={() => setIsLowBandwidth(!isLowBandwidth)} className={`px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 ${isLowBandwidth ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                <Wifi className="w-4 h-4" />
                <span className="hidden sm:inline">Low-Bandwidth</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRightPanel((prev) => !prev);
                  setRightTab('chat');
                  setUnreadChat(0);
                }}
                className={`relative px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 ${showRightPanel && rightTab === 'chat' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title="Toggle Session Chat"
              >
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Chat</span>
                {unreadChat > 0 && (!showRightPanel || rightTab !== 'chat') && (
                  <span className="ml-0.5 rounded-full bg-red-600 text-white text-[10px] font-black px-1.5 py-0.2">
                    {unreadChat}
                  </span>
                )}
              </button>
              <button onClick={() => handleEndCall(true)} disabled={endingCall} className="border border-red-300 bg-red-50 hover:bg-red-100 text-red-700 font-bold px-4 py-2.5 rounded-xl cursor-pointer flex items-center gap-1.5 disabled:opacity-60">
                <XCircle className="w-4 h-4" />
                <span>Decline Call</span>
              </button>
              <button onClick={() => handleEndCall(false)} disabled={endingCall} className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-sm cursor-pointer flex items-center gap-1.5 disabled:opacity-60">
                <PhoneOff className="w-4 h-4" />
                <span>{endingCall ? 'Ending...' : 'End Call'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Incoming / Waiting Calls Card + Live Session Chat */}
        {(() => {
          const visibleWaiting = waitingCalls.filter((c) => !clearedWaitingRefs.includes(c.reference));
          const hasWaiting = currentUser.role === 'interpreter' && visibleWaiting.length > 0 && !endingCall;
          if (!showRightPanel && !hasWaiting) return null;
          const widthClass = chatWidth === 'narrow' ? 'md:w-72' : chatWidth === 'wide' ? 'md:w-[28rem] lg:w-[32rem]' : 'md:w-80 lg:w-96';
          return (
        <aside className={`w-full ${widthClass} max-h-[48vh] md:max-h-none flex-shrink-0 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col gap-3 p-3 overflow-hidden transition-all duration-200`}>
          {/* Top Card: Incoming / Waiting Calls (interpreters only when calls are waiting) */}
          {hasWaiting && (
            <div className="rounded-2xl border border-emerald-200 bg-slate-50 p-3 flex flex-col gap-2.5 max-h-64 overflow-y-auto flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-emerald-600 animate-pulse" />
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    Incoming Call ({visibleWaiting.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setClearedWaitingRefs((prev) => [...prev, ...visibleWaiting.map((c) => c.reference)])}
                  className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-lg cursor-pointer"
                >
                  Clear All
                </button>
              </div>
              {visibleWaiting.map((call) => {
                void tick;
                const expiresAt = call.assignmentExpiresAt ? new Date(call.assignmentExpiresAt).getTime() : 0;
                const createdMs = call.createdAt ? new Date(call.createdAt).getTime() : Date.now();
                const secondsLeft = expiresAt
                  ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
                  : Math.max(0, 60 - Math.max(0, Math.floor((Date.now() - createdMs) / 1000)));
                const isMissed = secondsLeft <= 0;
                return (
                  <div key={call.reference} className={`rounded-xl border-2 p-3 space-y-2 shadow-xs transition-colors ${isMissed ? 'border-red-500 bg-red-100/90' : 'border-emerald-400 bg-emerald-50/70'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-800 font-bold">{call.reference}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-mono font-black px-2 py-0.5 rounded-md ${isMissed ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                          {secondsLeft}s
                        </span>
                        <button
                          type="button"
                          onClick={() => setClearedWaitingRefs((prev) => [...prev, call.reference])}
                          className="p-0.5 rounded text-slate-500 hover:text-slate-900 cursor-pointer"
                          title="Clear card"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="font-bold text-slate-900 text-xs leading-tight truncate">{call.requesterName} <span className="font-normal text-slate-600">wants to connect</span></p>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-black text-blue-700">{call.sourceLanguage?.toUpperCase()}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-black text-slate-900">{call.targetLanguage?.toUpperCase()}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600 capitalize truncate">{call.serviceCategory?.replace(/_/g, ' ')}</span>
                      {call.urgency === 'emergency' && (
                        <span className="ml-auto text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black uppercase">Emergency</span>
                      )}
                    </div>
                    {isMissed ? (
                      <button
                        type="button"
                        disabled
                        className="w-full py-2 rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center justify-center cursor-not-allowed"
                      >
                        Missed Call
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTakeCall(call.reference)}
                        disabled={takingCall === call.reference}
                        className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        {takingCall === call.reference ? 'Connecting...' : 'Take Call'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Card: Session Chat & Participants (matches reference green-pill style + width controls) */}
          <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 bg-white flex flex-col overflow-hidden shadow-xs">
            <div className="p-2 border-b border-slate-100 flex items-center gap-1.5 bg-slate-50/70">
              <div className="flex-1 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setRightTab('chat')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    rightTab === 'chat' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Session Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab('participants')}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    rightTab === 'participants' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200/60'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Participants</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setChatWidth((w) => (w === 'wide' ? 'normal' : w === 'normal' ? 'narrow' : 'normal'))}
                disabled={chatWidth === 'narrow'}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                title="Make chat narrower"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setChatWidth((w) => (w === 'narrow' ? 'normal' : w === 'normal' ? 'wide' : 'wide'))}
                disabled={chatWidth === 'wide'}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                title="Make chat wider"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {rightTab === 'chat' ? (
              <>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {chatMessages.length === 0 && (
                    <div className="text-center py-8 text-xs text-slate-400">
                      Send a message to the other participant in this session.
                    </div>
                  )}
                  {chatMessages.map((msg) => {
                    const isMe = msg.senderId === currentUser.id;
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] font-semibold text-slate-400 mb-1 px-1">
                          {isMe ? 'You' : msg.senderName} · {msg.timestamp}
                        </span>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                            isMe
                              ? 'bg-emerald-600 text-white rounded-br-sm'
                              : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleSendChat} className="p-2.5 border-t border-slate-100 flex items-center gap-2 bg-slate-50/50">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type message..."
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    className="h-9 w-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center cursor-pointer shrink-0 shadow-xs"
                    title="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900">{currentUser.fullName} (You)</p>
                    <p className="text-[11px] text-slate-500 capitalize">{currentUser.role}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Connected</span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900">{remoteParticipantName || session.interpreterName || 'Participant'}</p>
                    <p className="text-[11px] text-slate-500">{session.organizationName}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${remoteParticipantName ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {remoteParticipantName ? 'Connected' : 'Waiting'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </aside>
          );
        })()}

        {/* Sidebar Glossary */}
        {showTerminology && (
          <div className="w-80 bg-slate-950/85 backdrop-blur-2xl border-l border-white/15 p-4 overflow-y-auto flex flex-col justify-between z-20">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center space-x-2">
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Linguistic Glossary
                  </h3>
                </div>
                <button
                  onClick={() => setShowTerminology(false)}
                  className="text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="p-2.5 bg-slate-800/80 rounded-lg text-xs">
                  <div className="font-bold text-blue-400">Clinical Consent (á‹¨áˆ•áŠ­áˆáŠ“ áˆá‰ƒá‹µ)</div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    <strong>Amharic:</strong> á‹¨áˆ…áŠ­áˆáŠ“ áˆµáˆáˆáŠá‰µ áˆ˜áˆµáŒ á‰µ
                    <br />
                    <strong>Oromo:</strong> Hayyama yaalaa kennuu
                    <br />
                    <strong>Tigrinya:</strong> áˆµáˆáˆá‹• áˆ•áŠ­áˆáŠ“ áˆáˆƒá‰¥
                  </div>
                </div>

                <div className="p-2.5 bg-slate-800/80 rounded-lg text-xs">
                  <div className="font-bold text-blue-400">Sworn Testimony (á‹¨áˆ˜áˆƒáˆ‹ á‰ƒáˆ)</div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    <strong>Amharic:</strong> á‹¨áˆ˜áˆáˆ‹ á‰ƒáˆ áˆ˜áˆµáŒ á‰µ
                    <br />
                    <strong>Oromo:</strong> Kakuudhaan ragaa kennuu
                    <br />
                    <strong>Somali:</strong> Markhaati dhaar ah
                  </div>
                </div>

                <div className="p-2.5 bg-slate-800/80 rounded-lg text-xs">
                  <div className="font-bold text-blue-400">Triage / Emergency (áŠ áˆµá‰¸áŠ³á‹­ áˆ•áŠ­áˆáŠ“)</div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    <strong>Amharic:</strong> á‹µáŠ•áŒˆá‰°áŠ› á‹¨áˆ•áŠ­áˆáŠ“ áŠ¥áˆ­á‹³á‰³
                    <br />
                    <strong>Oromo:</strong> Yaala ariifachiisaa
                    <br />
                    <strong>Tigrinya:</strong> áˆ…áŒ¹áŒ½ áˆ¨á‹µáŠ¤á‰µ áˆ•áŠ­áˆáŠ“
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 text-[10px] text-slate-400">
              Verified clinical & legal terminology.
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
