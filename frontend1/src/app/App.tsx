import { AlertCircle, Bot, Info, RefreshCw } from 'lucide-react';
import { ClientPortal } from '../client/ClientPortal';
import { CompletionReportModal } from '../shared/components/CompletionReportModal';
import { FeedbackModal } from '../shared/components/FeedbackModal';
import { Header } from '../shared/components/Header';
import { LiveSessionRoom } from '../shared/components/LiveSessionRoom';
import { MeetingRoom } from '../shared/components/MeetingRoom';
import { MeetingInviteToast } from '../shared/components/MeetingInviteToast';
import { CreateMeetingModal } from '../shared/components/CreateMeetingModal';
import { ChangePasswordPage } from '../shared/components/ChangePasswordPage';
import { LandingPage } from '../shared/components/LandingPage';
import { LoginPage } from '../shared/components/LoginPage';
import { NotificationDrawer } from '../shared/components/NotificationDrawer';
import { OrzoSupportModal } from '../shared/components/OrzoSupportModal';
import { CommunicationMode, ServiceCategory } from '../shared/types';
import { isClient, isStaff } from '../shared/roles';
import { StaffWorkspace } from '../staff/StaffWorkspace';
import { useState } from 'react';
import { usePortal } from '../shared/usePortal';
import { InvitePasswordPage } from '../shared/components/InvitePasswordPage';
import { workplaceOf } from '../shared/workplace';
import { resolveCallRoom } from '../shared/callRoom';

function inviteEmailFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('change-password') !== '1') return null;
  return params.get('email') || '';
}

export default function App() {
  const portal = usePortal();
  const { currentUser, settings, loading, error } = portal;
  const [inviteEmail, setInviteEmail] = useState<string | null>(inviteEmailFromLocation);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const activeSessionForUser = (() => {
    if (!currentUser || currentUser.role === 'platform_admin' || currentUser.role === 'supervisor') return undefined;
    if (currentUser.role === 'interpreter') {
      return portal.interpreterProfile?.activeSessionId;
    }
    return portal.requests.find(
      (request) => request.requesterId === currentUser.id && request.status === 'in_session' && request.activeSessionId,
    )?.activeSessionId;
  })();

  const matchingRequest = portal.requests.find(
    (request) =>
      request.activeSessionId === portal.activeSessionRoomId ||
      ['assigned', 'in_session', 'matching'].includes(request.status)
  );

  const currentLiveSession = portal.activeSessionRoomId
    ? portal.sessions.find((session) => session.id === portal.activeSessionRoomId) || (() => {
        const fallback = {
          id: portal.activeSessionRoomId,
          requestReference: matchingRequest?.reference || 'REQ-LIVE',
          sessionToken: 'SES-LIVE-TOKEN',
          status: 'active' as const,
          communicationMode: (matchingRequest?.modality || 'video') as CommunicationMode,
          lowBandwidthMode: settings?.telecomLowBandwidthPreset || true,
          recordingEnabled: false,
          durationSeconds: 0,
          clientId: currentUser?.id || 'usr-client',
          clientName: currentUser?.fullName || 'Client',
          interpreterName:
            matchingRequest?.assignedInterpreterName ||
            portal.interpreterProfile?.fullName ||
            'Chaltu Kebede (Certified)',
          organizationName: currentUser?.organizationName || 'Tikur Anbessa Specialized Hospital',
          sourceLanguage: matchingRequest?.sourceLanguage || 'orm',
          targetLanguage: matchingRequest?.targetLanguage || 'amh',
          serviceCategory: (matchingRequest?.serviceCategory || 'healthcare') as ServiceCategory,
          connectionHealth: 'optimal' as const,
          authorizedParticipantIds: [currentUser?.id || ''],
        };
        return { ...fallback, callRoom: resolveCallRoom(fallback) };
      })()
    : null;

  if (loading && !currentUser && sessionStorage.getItem('orzo-web-session') === '1') {
    return (
      <div className="min-h-screen bg-[#0E2A3A] flex flex-col items-center justify-center text-white p-4">
        <img src="/orzo-logo.png" alt="ORZO" className="w-24 h-24 rounded-full mb-4" />
        <h2 className="text-lg font-bold">ORZO Translation & Interpretation</h2>
        <p className="text-xs text-slate-300 mt-1">Connecting to secure dispatch platform...</p>
        <RefreshCw className="w-5 h-5 text-teal-300 animate-spin mt-4" />
      </div>
    );
  }

  if (error && !currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full border border-red-200 text-center">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-2" />
          <h3 className="text-base font-bold text-gray-900">Connection Error</h3>
          <p className="text-xs text-gray-600 mt-2">{error}</p>
          <button
            onClick={() => portal.refreshData()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!currentUser && inviteEmail !== null) {
    return (
      <InvitePasswordPage
        initialEmail={inviteEmail}
        onComplete={portal.acceptPasswordSetup}
        onBack={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setInviteEmail(null);
        }}
      />
    );
  }

  if (!currentUser) {
    if (showLogin) {
      return (
        <LoginPage
          onLogin={async (email, password) => {
            await portal.handleLogin(email, password);
            setShowLogin(false);
          }}
        />
      );
    }
    return <LandingPage onLogin={() => setShowLogin(true)} />;
  }

  if (currentUser.mustChangePassword) {
    return (
      <ChangePasswordPage
        user={currentUser}
        required
        onComplete={portal.completePasswordChange}
        onCancel={portal.handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {settings?.systemBannerNotice && (
        <div className="bg-slate-900 text-slate-300 text-[11px] font-medium py-1.5 px-4 text-center border-b border-slate-800 flex items-center justify-center space-x-2">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>{settings.systemBannerNotice}</span>
        </div>
      )}

      <Header
        currentUser={currentUser}
        users={portal.allUsers}
        onSwitchUser={portal.handleSwitchUser}
        notifications={portal.notifications}
        onOpenNotifications={() => portal.setIsNotificationOpen(true)}
        currentLocale={portal.locale}
        onChangeLocale={portal.setLocale}
        activeSessionId={activeSessionForUser}
        onJoinActiveSession={(sessionId) => portal.setActiveSessionRoomId(sessionId)}
        pendingCompletionSessionIds={portal.pendingCompletionSessionIds}
        onOpenPendingCompletion={(sessionId) => portal.setCompletionModalSessionId(sessionId)}
        onLogout={portal.handleLogout}
      />

      {isClient(currentUser) && (
        <main className="flex-1 w-full flex flex-col">
          <ClientPortal
            currentUser={currentUser}
            requests={portal.requests}
            languages={portal.languages}
            onCreateRequest={portal.handleCreateRequest}
            onCancelRequest={portal.handleCancelRequest}
            onJoinSession={(sessionId) => portal.setActiveSessionRoomId(sessionId)}
            onOpenFeedback={(sessionId) => portal.setFeedbackModalSessionId(sessionId)}
            initialSourceLanguage={portal.preselectedSourceLanguage}
            onOpenSupport={() => portal.openSupport(false)}
          />
        </main>
      )}

      {isStaff(currentUser) && <StaffWorkspace portal={portal} onOpenCreateMeeting={currentUser.role === 'platform_admin' ? () => setShowCreateMeeting(true) : undefined} />}

      <footer className="bg-white border-t border-gray-200 mt-auto py-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 gap-2">
          <div>
            <strong>ORZO Translation & Interpretation</strong> • Ethiopian Language Interpretation Platform
          </div>
          <div className="flex items-center space-x-3 text-[11px]">
            <span>Amharic • Afaan Oromoo • Tigrinya • Somali • Sidama • Wolaytta</span>
            <span>•</span>
            <span className="text-blue-700 font-semibold">Institutional Dispatch</span>
          </div>
        </div>
      </footer>

      {portal.activeSessionRoomId && currentLiveSession && (
        <LiveSessionRoom
          session={currentLiveSession}
          currentUser={currentUser}
          onEndSession={portal.handleEndSession}
          onClose={() => portal.setActiveSessionRoomId(null)}
          onCallFinished={(sessionId, status) => {
            portal.setActiveSessionRoomId(null);
            const bySelf = portal.consumeEndedBySelf(sessionId);
            if (!bySelf && status === 'cancelled') {
              portal.setCallDeclinedInfo({
                sessionId,
                message: 'The call was declined by the other side.',
              });
            } else if (currentUser.role === 'client' && status === 'completed') {
              portal.setFeedbackModalSessionId(sessionId);
            }
            portal.refreshData();
          }}
          onOpenCompletionModal={(sessionId) => {
            portal.setActiveSessionRoomId(null);
            portal.setCompletionModalSessionId(sessionId);
            // Refresh so any pending assignment ring appears right away
            if (currentUser.role === 'interpreter') portal.refreshData();
          }}
          onTakeWaitingCall={portal.handleTakeWaitingCall}
          pendingCompletionSessionIds={portal.pendingCompletionSessionIds}
          onOpenPendingCompletion={(sessionId) => portal.setCompletionModalSessionId(sessionId)}
        />
      )}

      {portal.completionModalSessionId && (
        <CompletionReportModal
          sessionId={portal.completionModalSessionId}
          isOpen={!!portal.completionModalSessionId}
          onClose={() => portal.setCompletionModalSessionId(null)}
          onSubmit={portal.handleSubmitCompletion}
        />
      )}

      {portal.feedbackModalSessionId && (
        <FeedbackModal
          sessionId={portal.feedbackModalSessionId}
          interpreterName={portal.requests.find((item) => item.activeSessionId === portal.feedbackModalSessionId)?.assignedInterpreterName}
          isOpen={!!portal.feedbackModalSessionId}
          onClose={() => portal.setFeedbackModalSessionId(null)}
          onSubmit={portal.handleSubmitFeedback}
          workplace={currentUser ? workplaceOf(currentUser) : 'healthcare'}
        />
      )}

      <NotificationDrawer
        isOpen={portal.isNotificationOpen}
        onClose={() => portal.setIsNotificationOpen(false)}
        notifications={portal.notifications}
        onMarkRead={portal.handleMarkNotificationRead}
        onClearNotification={portal.handleClearNotification}
        onClearAllNotifications={portal.handleClearAllNotifications}
      />

      <button
        type="button"
        onClick={() => portal.openSupport(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-blue-700 py-2.5 pl-3 pr-4 text-white shadow-lg hover:bg-blue-800 cursor-pointer"
        title="ORZO Support"
      >
        <Bot className="h-4 w-4" />
        <span className="text-xs font-bold">ORZO Support</span>
      </button>

      <OrzoSupportModal
        isOpen={portal.isOrzoSupportOpen}
        announce={portal.supportVoice}
        expanded={portal.supportExpanded}
        locale={portal.locale}
        onClose={portal.closeSupport}
        onSelectLanguageForRequest={(langCode) => portal.setPreselectedSourceLanguage(langCode)}
      />

      {/* Duplicate floating ring overlay removed — InterpreterPortal renders the compact green/red incoming call card directly */}


      {portal.pendingMeetingInviteId && !portal.activeMeetingId && (() => {
        const invite = portal.meetings.find((m) => m.id === portal.pendingMeetingInviteId);
        if (!invite || !currentUser) return null;
        const host = invite.participants.find((p) => p.role === 'host');
        return (
          <MeetingInviteToast
            meeting={invite}
            hostName={host?.accountName || invite.creatorName}
            onJoin={() => portal.handleJoinMeeting(invite.id)}
            onDismiss={portal.handleDismissMeetingInvite}
          />
        );
      })()}

      {/* Call Declined / Ended by Other Side Card */}
      {portal.callDeclinedInfo && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-red-400/30 bg-slate-900 p-6 text-white shadow-2xl text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-500/20 border border-red-400/40 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Call Declined</h3>
              <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                {portal.callDeclinedInfo.message}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {currentUser.role === 'client' && portal.callDeclinedInfo.sessionId && (
                <button
                  type="button"
                  onClick={() => {
                    const sid = portal.callDeclinedInfo?.sessionId;
                    portal.setCallDeclinedInfo(null);
                    if (sid) portal.setFeedbackModalSessionId(sid);
                  }}
                  className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer"
                >
                  Rate Session
                </button>
              )}
              {currentUser.role === 'interpreter' && portal.callDeclinedInfo.sessionId && (
                <button
                  type="button"
                  onClick={() => {
                    const sid = portal.callDeclinedInfo?.sessionId;
                    portal.setCallDeclinedInfo(null);
                    if (sid) portal.setCompletionModalSessionId(sid);
                  }}
                  className="flex-1 h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer"
                >
                  Complete Report
                </button>
              )}
              <button
                type="button"
                onClick={() => portal.setCallDeclinedInfo(null)}
                className="flex-1 h-11 rounded-xl border border-white/20 bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Meeting Room overlay */}
      {portal.activeMeetingId && (() => {
        const activeMeeting = portal.meetings.find((m) => m.id === portal.activeMeetingId);
        if (!activeMeeting || !currentUser) return null;
        return (
          <MeetingRoom
            meeting={activeMeeting}
            currentUser={currentUser}
            onEnd={portal.handleEndMeeting}
            onClose={() => portal.setActiveMeetingId(null)}
          />
        );
      })()}

      {/* Create Meeting Modal (platform_admin only) */}
      {currentUser?.role === 'platform_admin' && (
        <CreateMeetingModal
          currentUser={currentUser}
          isOpen={showCreateMeeting}
          onClose={() => setShowCreateMeeting(false)}
          onCreate={async (data) => {
            const meeting = await portal.handleCreateMeeting(data);
            setShowCreateMeeting(false);
            return meeting;
          }}
        />
      )}
    </div>
  );
}
