import { 
  EmbedBuilder as DiscordEmbedBuilder,
  Colors
} from 'discord.js';
import { RankedSeminarRecord } from '../models/SeminarRecord';
import Logger from '../utils/Logger';

/**
 * Discordエンベッドを構築するクラス
 */
export default class EmbedBuilder {
  private logger: Logger;
  
  // カテゴリごとの色の定義
  private readonly categoryColors: Record<string, number> = {
    'フロントエンド': Colors.Blue,
    'バックエンド': Colors.Green,
    'インフラ': Colors.Red,
    'AI': Colors.Purple,
    'デザイン': Colors.Gold,
    'その他': Colors.Grey
  };

  /**
   * EmbedBuilderのコンストラクタ
   */
  constructor() {
    this.logger = new Logger('EmbedBuilder');
  }

  /**
   * 検索結果のエンベッドを構築
   * @param seminar ランク付けされたセミナーレコード
   * @param index 結果のインデックス
   * @returns 構築されたエンベッド
   */
  buildSeminarResultEmbed(seminar: RankedSeminarRecord, index: number) {
    const categories = seminar.categories || [];
    const tools = seminar.tools || [];
    const primaryCategory = categories.length > 0 ? categories[0] : 'その他';
    
    // カテゴリに基づいて色を決定
    const color = this.categoryColors[primaryCategory] || Colors.Default;
    
    // エンベッドの作成
    const embed = new DiscordEmbedBuilder()
      .setTitle(seminar.title || '無題のセミナー')
      .setDescription(seminar.description || '説明なし')
      .setColor(color)
      .addFields(
        { name: 'カテゴリ', value: categories.join(', ') || 'なし', inline: true },
        { name: 'ツール', value: tools.join(', ') || 'なし', inline: true }
      );
    
    // 開催日がある場合は追加
    if (seminar.eventDate) {
      embed.addFields({ name: '開催日', value: seminar.eventDate, inline: true });
    }
    
    // サムネイルがある場合は追加
    if (seminar.thumbnailUrl) {
      embed.setThumbnail(seminar.thumbnailUrl);
    }
    
    // URLがある場合は追加
    if (seminar.url) {
      embed.setURL(seminar.url);
    }
    
    this.logger.debug(`セミナー結果エンベッドを構築しました: ${index + 1}`, {
      title: seminar.title,
      score: seminar.score
    });
    
    return embed;
  }

  /**
   * 検索結果がない場合のエンベッドを構築
   * @param query 検索クエリ
   * @param alternativeKeywords 代替キーワードの配列
   * @returns 構築されたエンベッド
   */
  buildNoResultsEmbed(query: string, alternativeKeywords: string[]) {
    const embed = new DiscordEmbedBuilder()
      .setTitle('検索結果が見つかりませんでした')
      .setDescription(`「${query}」に一致するセミナーが見つかりませんでした。`)
      .setColor(Colors.Red)
      .addFields(
        { 
          name: '代わりに以下のキーワードをお試しください', 
          value: alternativeKeywords.map(kw => `・${kw}`).join('\n') || '代替キーワードがありません' 
        }
      );
    
    this.logger.info('検索結果なしエンベッドを構築しました', {
      query,
      alternativeKeywords
    });
    
    return embed;
  }

  /**
   * エラーメッセージのエンベッドを構築
   * @param errorMessage エラーメッセージ
   * @returns 構築されたエンベッド
   */
  buildErrorEmbed(errorMessage: string) {
    const embed = new DiscordEmbedBuilder()
      .setTitle('エラーが発生しました')
      .setDescription(errorMessage)
      .setColor(Colors.Red);
    
    this.logger.info('エラーエンベッドを構築しました', { errorMessage });
    
    return embed;
  }
}
