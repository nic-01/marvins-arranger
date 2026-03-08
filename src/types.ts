export interface Song {
  id: string;
  title: string;
  artist: string;
  year: number;
  decade: string;
  bpm: number;
  key: string;
  time_signature: string;
  genre: string;
  vocal_gender: 'Male' | 'Female' | 'Mixed' | 'Instrumental';
  energy: 'Low' | 'Medium' | 'High';
  crowd_singalong: boolean;
  horn_friendly: boolean;
  keyboard_driven: boolean;
  guitar_driven: boolean;
  danceability: 'Low' | 'Medium' | 'High';
  notes: string;
}

export interface MedleySong extends Song {
  medleyId: string;
  snippet_duration: number; // seconds, default 45
  section?: 'chorus' | 'verse' | 'bridge' | 'instrumental';
  bar_count?: number;
  tempo_treatment?: string;
  transition_in?: TransitionType;
  featured_instruments?: string[];
  crowd_moment?: boolean;
  easter_egg?: boolean;
  arrangement_notes?: string;
}

export type TransitionType =
  | 'hard_cut'
  | 'tempo_ramp'
  | 'key_ramp'
  | 'drum_fill'
  | 'bass_bridge'
  | 'vamp_fade';

export interface EasterEgg {
  id: string;
  source_song: string;
  source_decade: string;
  host_decade: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Very Hard';
  notes: string;
}

export interface DecadeSection {
  decade: string;
  songs: MedleySong[];
  targetTime: number; // minutes
}

export interface Filters {
  decade: string;
  bpmMin: number;
  bpmMax: number;
  key: string;
  genre: string;
  vocal_gender: string;
  energy: string;
  horn_friendly: string;
  keyboard_driven: string;
  search: string;
}

// Camelot wheel position
export interface CamelotPosition {
  number: number; // 1-12
  letter: 'A' | 'B'; // A = minor, B = major
}

// Song preference tracking
export type SongPreference = 'starred' | 'deleted' | 'open';

export interface SongPreferenceLog {
  songId: string;
  action: SongPreference;
  timestamp: number;
}

export interface SongPreferences {
  starred: Set<string>;
  deleted: Set<string>;
  log: SongPreferenceLog[];
}

// Block preference tracking (Netflix-style preference learning)
export type BlockRating = 1 | 2 | 3 | 4 | 5;

export interface BlockPreferenceLog {
  /** Fingerprint: sorted song IDs joined, identifies a unique block composition */
  blockFingerprint: string;
  songIds: string[];
  decade: string;
  rating: BlockRating;
  timestamp: number;
  /** Metadata captured at rating time for ML/LLM analysis */
  meta: {
    avgScore: number;
    avgEnergy: number;
    hasMashup: boolean;
    hasCrowdMoment: boolean;
    bpmRange: [number, number];
    genres: string[];
  };
}
