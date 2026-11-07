export interface User {
  email: string;
  timezone: string;
  sendTimes: string[];
  notionUrl: string;
  paused: boolean;
  youtubeConnected: boolean;
}

export interface Features {
  youtubeConnect: boolean;
  fullChannelHistory: boolean;
}

export interface Channel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
}

export interface Video {
  id: string;
  title: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  url: string;
}

export interface Progress {
  total: number;
  watched: number;
}

export interface TodayItem {
  channel: Channel;
  video: Video | null;
  progress: Progress;
}

export interface RecentItem {
  videoId: string;
  title: string;
  watchedAt: string;
  url: string;
}

export interface DashboardData {
  user: User;
  features: Features;
  today: TodayItem[];
  recent: RecentItem[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type LinkInfo =
  | { action: 'watched'; email: string; video: Video; alreadyWatched: boolean }
  | { action: 'pause'; email: string; paused: boolean };
