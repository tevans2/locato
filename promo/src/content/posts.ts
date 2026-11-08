// The finished post for each channel, from a caption, a title and a link. Shared by the Mac tools (rendered videos
// and manual uploads) and the promo service (uploads from the admin), so every video is posted the same way.
// Pure: no Node APIs.

export const CHANNELS = ['tiktok', 'instagram', 'youtube'] as const;
export type Channel = (typeof CHANNELS)[number];
export type Post = {text: string; metadata: unknown; assets: unknown};

/** The ?ref= value for a video name (what the game's analytics records as its source). */
export const refFor = (name: string) => name.replace(/[^a-z0-9]+/g, '').slice(0, 24);
export const linkFor = (name: string) => `https://locato.quest/?ref=${refFor(name)}`;

/** A file name → a video name: lowercase letters, digits and dashes. */
export const videoName = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'video';

/** A YouTube title from a caption when none is given: hashtags dropped, up to 90 characters. */
export const titleFromCaption = (caption: string) => caption.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/👇/gu, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Geography challenge 🌍';

export function buildPosts(o: {video: string; caption: string; title: string; link: string; rounds?: number; channels?: readonly Channel[]}): Partial<Record<Channel, Post>> {
  const caption = o.caption.split('\n')[0].trim();
  const assets = [{video: {url: o.video, metadata: {thumbnailOffset: 400}}}];
  const social = `${caption}\n\nPlay free: link in bio 🔗`; // links in TikTok/Instagram captions aren't clickable
  const all: Record<Channel, Post> = {
    tiktok: {text: social, assets, metadata: {tiktok: {isAiGenerated: false}}}, // AI-content label: off (the owner's call)
    instagram: {text: social, assets, metadata: {instagram: {type: 'reel', shouldShareToFeed: true}}},
    youtube: {
      text: `${caption}\n\nPlay free in your browser: ${o.link}${o.rounds ? `\n\n${o.rounds} rounds, easy to boss. Comment your score!` : ''}`,
      assets,
      metadata: {youtube: {title: o.title.replace(/\s+/g, ' ').trim().slice(0, 90), categoryId: '27', privacy: 'public', madeForKids: false, notifySubscribers: true}},
    },
  };
  const want = o.channels?.length ? o.channels : CHANNELS;
  return Object.fromEntries(want.map((c) => [c, all[c]])) as Partial<Record<Channel, Post>>;
}

/** Upload checks for a finished video (the same in the CLI and the admin). Errors stop the upload; warnings don't. */
export const VIDEO_LIMITS = {maxBytes: 60 * 1024 * 1024, maxSeconds: 600};
export function checkVideo(v: {width: number; height: number; duration: number; bytes: number; codec?: string | null}) {
  const errors: string[] = [], warnings: string[] = [];
  if (v.bytes > VIDEO_LIMITS.maxBytes) errors.push(`${(v.bytes / 1048576).toFixed(1)} MB is over the ${VIDEO_LIMITS.maxBytes >> 20} MB upload limit (export at a lower bitrate)`);
  if (!(v.duration > 0)) errors.push("couldn't read the video's length");
  else if (v.duration > VIDEO_LIMITS.maxSeconds) errors.push(`${Math.round(v.duration)}s is too long (max ${VIDEO_LIMITS.maxSeconds / 60} minutes)`);
  else {
    if (v.duration > 180) warnings.push(`${Math.round(v.duration)}s: over 3 minutes, so YouTube may post it as a regular video, not a Short`);
    if (v.duration > 90) warnings.push(`${Math.round(v.duration)}s: Instagram may not show a Reel this long everywhere; under 90s is safest`);
  }
  if (v.width && v.height) {
    const r = v.width / v.height;
    if (r > 1) errors.push(`${v.width}×${v.height} is landscape; Shorts, Reels and TikTok need portrait (9:16, e.g. 1080×1920)`);
    else if (Math.abs(r - 9 / 16) > 0.03) warnings.push(`${v.width}×${v.height} isn't 9:16, so platforms will crop or add bars`);
    if (v.height < 1280) warnings.push(`${v.width}×${v.height} is low resolution (1080×1920 is best)`);
  }
  if (v.codec && !['h264', 'hevc'].includes(v.codec)) warnings.push(`codec ${v.codec}: H.264 is the safest for every platform`);
  return {errors, warnings};
}
