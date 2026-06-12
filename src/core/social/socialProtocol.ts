// Shared protocol for the persistent app-wide "social" WebSocket (presence, friend events,
// game invites). Distinct from the per-room multiplayer transport. Actions (send/accept friend
// request, invite) go over HTTP; this channel only carries server-pushed events + a heartbeat.

export interface PublicUserRef {
  readonly id: string;
  readonly username: string;
  readonly avatarEmoji: string | null;
}

export type SocialServerMessage =
  | { readonly type: "PRESENCE_SNAPSHOT"; readonly onlineFriendIds: readonly string[] }
  | { readonly type: "PRESENCE"; readonly userId: string; readonly online: boolean }
  | { readonly type: "FRIEND_REQUEST"; readonly from: PublicUserRef }
  | { readonly type: "FRIEND_ACCEPTED"; readonly user: PublicUserRef }
  | { readonly type: "FRIENDS_CHANGED" }
  | { readonly type: "GAME_INVITE"; readonly from: PublicUserRef; readonly roomCode: string };

export type SocialClientMessage = { readonly type: "PING" };

// Server-side bridge handed to the HTTP layer so friend/invite routes can push live events
// and read presence. A no-op default keeps the routes usable without a running hub (tests).
export interface SocialBridge {
  isOnline(userId: string): boolean;
  notify(userId: string, message: SocialServerMessage): void;
}

export const NOOP_SOCIAL: SocialBridge = {
  isOnline: () => false,
  notify: () => undefined,
};
