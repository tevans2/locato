import type { SocialBridge, SocialServerMessage } from "../../src/core/social/socialProtocol";

export interface SocialConnection {
  readonly userId: string;
  send(data: string): void;
}

// Tracks which signed-in users have a live social socket (presence) and fans presence changes
// out to their friends. In-memory and single-machine, matching RoomManager's model.
export class SocialHub implements SocialBridge {
  // userId → set of connections (a user may have multiple tabs/devices open).
  private readonly connections = new Map<string, Set<SocialConnection>>();

  constructor(private readonly friendIds: (userId: string) => readonly string[]) {}

  isOnline(userId: string): boolean {
    return this.connections.has(userId);
  }

  attach(connection: SocialConnection): void {
    const wasOnline = this.connections.has(connection.userId);
    const set = this.connections.get(connection.userId) ?? new Set<SocialConnection>();
    set.add(connection);
    this.connections.set(connection.userId, set);

    // Tell the freshly-connected client which of its friends are already online.
    const onlineFriendIds = this.friendIds(connection.userId).filter((id) => this.connections.has(id));
    connection.send(JSON.stringify({ type: "PRESENCE_SNAPSHOT", onlineFriendIds } satisfies SocialServerMessage));

    // First connection for this user → they just came online; tell their online friends.
    if (!wasOnline) this.broadcastPresence(connection.userId, true);
  }

  detach(connection: SocialConnection): void {
    const set = this.connections.get(connection.userId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) {
      this.connections.delete(connection.userId);
      this.broadcastPresence(connection.userId, false);
    }
  }

  notify(userId: string, message: SocialServerMessage): void {
    const set = this.connections.get(userId);
    if (!set) return;
    const data = JSON.stringify(message);
    for (const connection of set) connection.send(data);
  }

  private broadcastPresence(userId: string, online: boolean): void {
    for (const friendId of this.friendIds(userId)) {
      this.notify(friendId, { type: "PRESENCE", userId, online });
    }
  }
}
