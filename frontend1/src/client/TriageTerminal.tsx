import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  InterpretationRequest,
  SupportedLanguage,
  CommunicationMode
} from '../shared/types';
import {
  Video,
  PhoneCall,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  Check
} from 'lucide-react';
import { workplaceContext, workplaceLanguageLabel, workplaceOf } from '../shared/workplace';

// ── Waiting / searching state component ──────────────────────────────────────
interface WaitingStateProps {
  ringingRequest: InterpretationRequest | undefined;
  interpreterReady: boolean;
  declinedByOther?: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  callMode: 'audio' | 'video';
  organizationName: string;
  languageName: (code?: string) => string;
  onJoinSession: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
  attempt: number;
  onOpenSupport: () => void;
}

function WaitingState({
  ringingRequest, interpreterReady, declinedByOther, sourceLanguage, targetLanguage,
  callMode, organizationName, languageName, onJoinSession, onBack, onRetry,
  attempt, onOpenSupport,
}: WaitingStateProps) {
  const [elapsed, setElapsed] = React.useState(0);
  const [noAnswer, setNoAnswer] = React.useState(false);

  React.useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // After 60 seconds with no interpreter, show the retry option.
  // On second attempt failure, auto-open ORZO Support.
  React.useEffect(() => {
    if (elapsed >= 60 && !interpreterReady) {
      if (attempt >= 2) {
        // Second attempt also failed — go straight to AI support
        onOpenSupport();
      } else {
        setNoAnswer(true);
      }
    }
  }, [elapsed, interpreterReady, attempt, onOpenSupport]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const countdown = Math.max(0, 60 - elapsed);

  if (declinedByOther) {
    return (
      <div className="space-y-4 text-white">
        <div className="rounded-2xl border border-red-500/40 bg-red-950/60 px-5 py-6 text-center space-y-3 backdrop-blur-md">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/20 border border-red-400/40 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-300" />
          </div>
          <h2 className="text-xl font-black text-white">Call Declined</h2>
          <p className="text-sm text-red-200">
            The call was declined and the session has ended for both sides.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 mt-2"
          >
            <RefreshCw className="w-4 h-4" />
            Call Again
          </button>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full h-11 rounded-xl border border-white/20 bg-white/5 text-slate-300 text-xs font-bold cursor-pointer hover:bg-white/10"
        >
          Back to form
        </button>
      </div>
    );
  }

  if (interpreterReady && ringingRequest?.activeSessionId) {
    return (
      <div className="space-y-4 text-white">
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/60 px-5 py-6 text-center space-y-3 backdrop-blur-md">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
            <Check className="w-8 h-8 text-emerald-300" />
          </div>
          <h2 className="text-xl font-black text-white">Interpreter ready</h2>
          <p className="text-sm text-emerald-200">Your interpreter accepted the request and is waiting in the room.</p>
          <button
            type="button"
            onClick={() => onJoinSession(ringingRequest.activeSessionId!)}
            className="w-full h-13 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 mt-2"
          >
            {callMode === 'video' ? <Video className="w-4 h-4" /> : <PhoneCall className="w-4 h-4" />}
            Join {callMode === 'video' ? 'video' : 'audio'} call
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-xs text-slate-400 space-y-1">
          <p><span className="font-bold text-slate-200">Ref:</span> {ringingRequest.reference}</p>
          <p><span className="font-bold text-slate-200">Languages:</span> {languageName(ringingRequest.sourceLanguage)} → {languageName(ringingRequest.targetLanguage)}</p>
          <p><span className="font-bold text-slate-200">Mode:</span> {callMode === 'video' ? 'Video' : 'Audio'} · {organizationName}</p>
        </div>
      </div>
    );
  }

  if (noAnswer) {
    return (
      <div className="space-y-4 text-white">
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/60 px-5 py-6 text-center space-y-3 backdrop-blur-md">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-300" />
          </div>
          <h2 className="text-xl font-black text-white">No interpreter available yet</h2>
          <p className="text-sm text-amber-200">
            {attempt === 1
              ? 'No interpreter answered on the first try. We will ring again — a second attempt often connects.'
              : 'Still no answer. ORZO Support can help while you wait.'}
          </p>
          <p className="text-xs text-slate-400">Waited: <span className="font-mono font-bold text-white">{fmt(elapsed)}</span> · Attempt {attempt} of 2</p>
          <button
            type="button"
            onClick={onRetry}
            className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 mt-2"
          >
            <RefreshCw className="w-4 h-4" />
            {attempt === 1 ? 'Try again (second attempt)' : 'Open ORZO Support'}
          </button>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full h-11 rounded-xl border border-white/20 bg-white/5 text-slate-300 text-xs font-bold cursor-pointer hover:bg-white/10"
        >
          Back to form
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-white">
      <div className="rounded-2xl border border-blue-500/30 bg-slate-900/80 px-5 py-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-600/25 border border-blue-400/40 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-blue-200">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" style={{ animationDuration: '1.2s' }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-400" />
            </span>
            <PhoneCall className="w-3.5 h-3.5 text-blue-300 animate-pulse" />
            {attempt === 2 ? 'Ringing (Attempt 2)' : 'Ringing…'}
          </span>
          <span className="ml-auto font-mono text-lg font-black tabular-nums text-amber-300" title="Countdown timer">
            {fmt(countdown)}
          </span>
        </div>
        <h2 className="mt-4 text-xl font-black text-white leading-snug">
          Locating an available interpreter
        </h2>
        <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
          Please stay on this screen. Interpreters are being notified now.
        </p>
        {/* Animated ring bars */}
        <div className="mt-5 flex items-end justify-center gap-1.5 h-10">
          {[0.3,0.6,1.0,0.7,0.4,0.9,0.5,0.8,0.3].map((h, i) => (
            <span
              key={i}
              className="w-2 rounded-full bg-blue-400/80 animate-bounce"
              style={{ height: `${Math.round(h * 36)}px`, animationDelay: `${i * 0.08}s`, animationDuration: '0.9s' }}
            />
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-xs text-slate-400 space-y-1">
        <p><span className="font-bold text-slate-200">Ref:</span> {ringingRequest?.reference || '—'}</p>
        <p><span className="font-bold text-slate-200">Languages:</span> {languageName(sourceLanguage)} → {languageName(targetLanguage)}</p>
        <p><span className="font-bold text-slate-200">Mode:</span> {callMode === 'video' ? 'Video' : 'Audio'} · {organizationName}</p>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="w-full h-11 rounded-xl border border-white/20 bg-white/5 text-slate-300 text-xs font-bold cursor-pointer hover:bg-white/10"
      >
        Cancel and go back
      </button>
    </div>
  );
}



interface TriageTerminalProps {
  currentUser: User;
  requests: InterpretationRequest[];
  languages: SupportedLanguage[];
  onCreateRequest: (data: {
    sourceLanguage?: string;
    targetLanguage: string;
    isUnknownLanguage?: boolean;
    unknownLanguageNotes?: string;
    serviceCategory: any;
    urgency: any;
    modality: CommunicationMode;
    scheduleType: any;
    scheduledTime?: string;
    minRoutingContext: string;
  }) => Promise<string | undefined | void>;
  onCancelRequest: (reference: string, reason?: string) => Promise<void>;
  onJoinSession: (sessionId: string) => void;
  onOpenFeedback: (sessionId: string) => void;
  initialSourceLanguage?: string | null;
  onOpenSupport?: () => void;
}

export const TriageTerminal: React.FC<TriageTerminalProps> = ({
  currentUser,
  requests,
  languages,
  onCreateRequest,
  onJoinSession,
  initialSourceLanguage,
  onOpenSupport,
}) => {
  const workplace = workplaceOf(currentUser);
  const [sourceLanguage, setSourceLanguage] = useState(initialSourceLanguage || 'orm');
  const [targetLanguage, setTargetLanguage] = useState('amh');
  const [context, setContext] = useState('');
  const [callMode, setCallMode] = useState<'audio' | 'video'>('audio');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [calling, setCalling] = useState(false);
  const [declinedByOther, setDeclinedByOther] = useState(false);
  const [trackedRef, setTrackedRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(1);
  const ringRef = useRef<{ stop: () => void } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const routingContext = context.trim() || workplaceContext(workplace);

    setIsSubmitting(true);
    setCalling(true);
    // No outgoing ring sound — the waiting state is shown silently.
    try {
      const result = await onCreateRequest({
        sourceLanguage: sourceLanguage === 'unknown' ? undefined : sourceLanguage,
        targetLanguage,
        isUnknownLanguage: sourceLanguage === 'unknown',
        unknownLanguageNotes: sourceLanguage === 'unknown' ? 'Unknown dialect reported at desk' : undefined,
        serviceCategory: workplace,
        urgency: 'emergency',
        modality: callMode,
        scheduleType: 'immediate',
        minRoutingContext: routingContext,
      });

      // Keep waiting UI while interpreters ring — never auto-join the call room.
      if (result === 'waiting' || result === 'ringing') {
        return;
      }
      setCalling(false);
      if (result === 'no_interpreter') {
        setError('No interpreter available for this service and language.');
      } else {
        setError('The request was saved. An interpreter will be assigned from the dispatch queue.');
      }
    } catch (err: any) {
      setCalling(false);
      setError(err?.message || 'The request could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeLanguages = languages.filter((l) => l.isActive);
  const staffLanguageOptions = [
    { code: 'amh', label: 'Amharic (አማርኛ)' },
    { code: 'eng', label: 'English' },
    { code: 'orm', label: 'Oromo (Afaan Oromoo)' },
    { code: 'tir', label: 'Tigrinya (ትግርኛ)' },
  ].filter((opt) => opt.code !== sourceLanguage);

  const handleSourceLanguageChange = (nextSource: string) => {
    setSourceLanguage(nextSource);
    if (nextSource === targetLanguage) {
      const fallback = ['amh', 'eng', 'orm', 'tir'].find((code) => code !== nextSource);
      if (fallback) setTargetLanguage(fallback);
    }
  };

  // Derive active request from server state — this means the ringing page
  // shows even on page reload or if the user navigates away and comes back.
  const activeRequest = requests.find(
    (item) =>
      item.requesterId === currentUser.id &&
      ['submitted', 'validating', 'matching', 'assigned', 'pending_matching'].includes(item.status),
  );

  // Only show ring/wait UI after the desk starts a call from this form (no auto call on load).
  const ringingRequest = calling
    ? requests.find(
        (item) =>
          item.requesterId === currentUser.id &&
          ['matching', 'assigned', 'in_session', 'cancelled', 'unresolved'].includes(item.status),
      )
    : activeRequest; // also show if there's already an active request from a previous load

  const interpreterReady =
    Boolean(ringingRequest?.activeSessionId) &&
    (ringingRequest?.status === 'assigned' || ringingRequest?.status === 'in_session');

  // Show the ringing page if either the client just submitted (calling) OR
  // there is already an active request in progress (prevents double-submit).
  const showCalling = calling || Boolean(activeRequest) || declinedByOther;
  const phoneRinging = showCalling && !interpreterReady && !declinedByOther && !isSubmitting;
  const languageName = (code?: string) => languages.find((item) => item.code === code)?.name || (code ? code.toUpperCase() : 'Unknown language');

  // Track active request reference and detect if it is declined/unresolved while waiting.
  useEffect(() => {
    if (ringingRequest?.reference && ['matching', 'assigned', 'in_session'].includes(ringingRequest.status)) {
      setTrackedRef(ringingRequest.reference);
    }
  }, [ringingRequest?.reference, ringingRequest?.status]);

  useEffect(() => {
    if (!showCalling || isSubmitting) return;
    const target = trackedRef
      ? requests.find((item) => item.reference === trackedRef)
      : requests.find((item) => item.requesterId === currentUser.id &&
          ['submitted', 'validating', 'matching', 'assigned', 'pending_matching',
           'completed', 'cancelled', 'expired', 'unresolved', 'in_session'].includes(item.status));
    if (!target) return;
    if (['unresolved', 'cancelled'].includes(target.status)) {
      setDeclinedByOther(true);
    } else if (['completed', 'expired'].includes(target.status)) {
      setCalling(false);
      setDeclinedByOther(false);
      setTrackedRef(null);
      setAttempt(1);
    }
  }, [showCalling, currentUser.id, isSubmitting, requests, trackedRef]);

  useEffect(() => {
    if (!phoneRinging) {
      stopOutgoingRing(ringRef);
      return;
    }
    // No audio ring on the client side — the waiting state is visual only.
    return () => stopOutgoingRing(ringRef);
  }, [phoneRinging]);

  return (
    <div className={`relative w-full flex items-center justify-center overflow-hidden ${showCalling ? 'min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),transparent_40%),linear-gradient(135deg,#020617,#0f172a_60%,#020617)]' : 'min-h-[calc(100vh-140px)] p-4 sm:p-8 bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/40'}`}>
      {/* Triage Card */}
      <div className={`relative z-10 w-full ${showCalling ? 'max-w-md px-4 py-8' : 'max-w-xl rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-9 text-slate-900 space-y-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]'}`}>
        {!showCalling && (
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 px-5 py-4">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
              Request an Interpreter
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 font-medium">
              {currentUser.organizationName || 'Tikur Anbessa Specialized Hospital (Addis Ababa)'}
            </p>
          </div>
        )}

        {error && !showCalling && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {showCalling ? (
          <WaitingState
            key={attempt}
            ringingRequest={ringingRequest}
            interpreterReady={interpreterReady}
            declinedByOther={declinedByOther}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            callMode={callMode}
            organizationName={currentUser.organizationName}
            languageName={languageName}
            onJoinSession={onJoinSession}
            onBack={async () => {
              stopOutgoingRing(ringRef);
              const refToCancel = ringingRequest?.reference || trackedRef;
              setCalling(false);
              setDeclinedByOther(false);
              setTrackedRef(null);
              setAttempt(1);
              if (refToCancel && !declinedByOther) {
                await onCancelRequest(refToCancel, 'Call declined by caller').catch(() => undefined);
              }
            }}
            onRetry={async () => {
              stopOutgoingRing(ringRef);
              setDeclinedByOther(false);
              setTrackedRef(null);
              setCalling(false);
              setAttempt((a) => a + 1);
              await new Promise((r) => setTimeout(r, 100));
              setCalling(true);
              setIsSubmitting(true);
              try {
                await onCreateRequest({
                  sourceLanguage: sourceLanguage === 'unknown' ? undefined : sourceLanguage,
                  targetLanguage,
                  isUnknownLanguage: sourceLanguage === 'unknown',
                  serviceCategory: workplace,
                  urgency: 'emergency',
                  modality: callMode,
                  scheduleType: 'immediate',
                  minRoutingContext: context.trim() || workplaceContext(workplace),
                });
              } catch (err: any) {
                setCalling(false);
                setError(err?.message || 'Could not retry.');
              } finally {
                setIsSubmitting(false);
              }
            }}
            attempt={attempt}
            onOpenSupport={() => { stopOutgoingRing(ringRef); setCalling(false); setAttempt(1); onOpenSupport?.(); }}
          />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Languages Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 grid gap-4 sm:grid-cols-2">
            {/* Patient Language Dropdown */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                {workplaceLanguageLabel(workplace)}
              </label>
              <div className="relative">
                <select
                  value={sourceLanguage}
                  onChange={(e) => handleSourceLanguageChange(e.target.value)}
                  className="w-full h-11 px-3.5 pr-9 text-sm font-semibold border border-slate-200 rounded-xl bg-white text-slate-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition cursor-pointer shadow-xs"
                >
                  {activeLanguages.map((lang) => (
                    <option key={lang.code} value={lang.code} className="bg-white text-slate-900">
                      {lang.name} ({lang.nativeName})
                    </option>
                  ))}
                  <option value="unknown" className="bg-white text-slate-900">
                    Uncertain / Other Dialect
                  </option>
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>
            </div>

            {/* Staff Language Dropdown */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Staff Language
              </label>
              <div className="relative">
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full h-11 px-3.5 pr-9 text-sm font-semibold border border-slate-200 rounded-xl bg-white text-slate-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition cursor-pointer shadow-xs"
                >
                  {staffLanguageOptions.map((opt) => (
                    <option key={opt.code} value={opt.code} className="bg-white text-slate-900">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Context Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Context
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={workplaceContext(workplace)}
              className="w-full h-12 px-4 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
            />
          </div>

          {/* Call Preference (Audio vs Video) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Call Preference
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCallMode('audio')}
                className={`h-12 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  callMode === 'audio'
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <PhoneCall className="w-4 h-4" />
                <span>Audio Call</span>
                {callMode === 'audio' && <Check className="w-3.5 h-3.5 ml-0.5" />}
              </button>

              <button
                type="button"
                onClick={() => setCallMode('video')}
                className={`h-12 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  callMode === 'video'
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Video className="w-4 h-4" />
                <span>Video Call</span>
                {callMode === 'video' && <Check className="w-3.5 h-3.5 ml-0.5" />}
              </button>
            </div>
          </div>

          {/* Connect with Interpreter Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  <span>Connecting to Call...</span>
                </>
              ) : (
                <>
                  <span>Connect with Interpreter</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};

function stopOutgoingRing(ringRef: React.MutableRefObject<{ stop: () => void } | null>) {
  ringRef.current?.stop();
  ringRef.current = null;
}
