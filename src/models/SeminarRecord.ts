/**
 * セミナーレコードのインターフェース
 * Notionから取得したセミナー情報を表現
 */
export interface SeminarRecord {
  id: string;
  title: string;
  description: string; // セミナーの詳細説明
  summary?: string;   // 概要（後方互換性のために残す）
  url: string;
  categories: string[];
  tools: string[];
  eventDate: string;  // 開催日
  updated: string;    // 更新日
  thumbnailUrl?: string; // サムネイル画像のURL
  thumbnail?: string;    // 後方互換性のために残す
}

/**
 * ランク付けされたセミナーレコード
 */
export interface RankedSeminarRecord extends SeminarRecord {
  score: number;
  reason: string;
}
