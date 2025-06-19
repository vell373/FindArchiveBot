import { RankedSeminarRecord } from '../models/SeminarRecord';
import Logger from '../utils/Logger';
import ErrorHandler from '../utils/ErrorHandler';

/**
 * 検索結果を回答用プロンプトに変換するクラス
 */
export class Formatter {
  private logger: Logger;
  private errorHandler: ErrorHandler;

  /**
   * Formatterインスタンスを初期化
   */
  constructor() {
    this.logger = new Logger('Formatter');
    this.errorHandler = new ErrorHandler('Formatter');
  }

  /**
   * 検索結果をDiscord表示用にフォーマット
   * @param query - 検索クエリ
   * @param results - ランク付けされたセミナーレコードの配列
   * @returns フォーマットされた表示用テキスト
   */
  formatSearchResults(query: string, results: RankedSeminarRecord[]): string {
    try {
      // 検索結果がない場合
      if (!results || results.length === 0) {
        this.logger.info('検索結果がありません');
        return `「${query}」に関連するセミナーが見つかりませんでした。別のキーワードで試してみてください。`;
      }

      // ヘッダー部分
      let formattedText = `## 「${query}」の検索結果（${results.length}件）

`;

      // 各結果をフォーマット
      results.forEach((result, index) => {
        const categories = result.categories?.join(', ') || 'なし';
        const tools = result.tools?.join(', ') || 'なし';
        const date = result.eventDate || '日付なし';

        formattedText += `### ${index + 1}. ${result.title || '無題のセミナー'}
`;

        if (result.url) {
          formattedText += `🔗 ${result.url}\n`;
        }

        formattedText += `📅 開催日: ${date}\n`;
        formattedText += `🏷️ カテゴリ: ${categories}\n`;
        formattedText += `🔧 ツール: ${tools}\n`;

        if (result.description) {
          formattedText += `\n${this.truncateText(result.description, 300)}\n`;
        }

        if (result.reason) {
          formattedText += ` - ${result.reason}`;
        }

        formattedText += '\n\n';
      });

      // 文字数制限チェック (Discord は 2000 文字)
      if (formattedText.length > 1900) {
        this.logger.warn('メッセージが長すぎるためコンパクト表示に切り替えます', {
          originalLength: formattedText.length
        });
        formattedText = this.buildCompactResults(query, results);
      }

      this.logger.info('検索結果を整形しました', { 
        resultCount: results.length,
        textLength: formattedText.length
      });

      return formattedText;
    } catch (error) {
      this.errorHandler.handle(error);
      // エラーが発生した場合でも最低限の情報を返す
      return JSON.stringify({ 
        count: results?.length || 0, 
        error: '結果の整形中にエラーが発生しました',
        results: results?.map(r => ({ title: r.title })) || []
      }, null, 2);
    }
  }

  /**
   * 検索結果をコンパクトにフォーマット
   * @param query - 検索クエリ
   * @param results - ランク付けされたセミナーレコードの配列
   * @returns フォーマットされた表示用テキスト
   */
  private buildCompactResults(query: string, results: RankedSeminarRecord[]): string {
    try {
      // 検索結果がない場合
      if (!results || results.length === 0) {
        this.logger.info('検索結果がありません');
        return `「${query}」に関連するセミナーが見つかりませんでした。別のキーワードで試してみてください。`;
      }

      // 簡潔なフォーマット（コンパクト用）
      let formattedText = `「${query}」の検索結果（${results.length}件）:\n\n`;

      results.forEach((result, index) => {
        formattedText += `${index + 1}. **${result.title || '無題のセミナー'}**\n`;
      });

      return formattedText;
    } catch (error) {
      this.errorHandler.handle(error);
      // エラーが発生した場合でも最低限の情報を返す
      return JSON.stringify({ 
        count: results?.length || 0, 
        error: '結果の整形中にエラーが発生しました',
        results: results?.map(r => ({ title: r.title })) || []
      }, null, 2);
    }
  }

  /**
   * テキストを指定された長さに切り詰める
   * @param text - 切り詰めるテキスト
   * @param maxLength - 最大長さ（デフォルト: 200）
   * @returns 切り詰められたテキスト
   */
  private truncateText(text: string, maxLength = 200): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;

    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * メンション検索専用フォーマッタ（A形式）
 * 例:
 * 1. タイトル
 * 🔗 URL
 * 🏷️ カテゴリ: 初心者, 相談会
 * 🔧 ツール: ChatGPT, Gemini
   */
  public formatMentionResults(query: string, results: RankedSeminarRecord[]): string {
    if (!results || results.length === 0) {
      return `「${query}」に関連するセミナーが見つかりませんでした。`;
    }

    let header = `## 「${query}」の検索結果（${results.length}件）\n\n`;
    let body = '';
    const MAX_LEN = 1900;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      let section = `${i + 1}. ${r.title || '無題のセミナー'}\n`;
      if (r.url) section += `🔗 ${r.url}\n`;
      section += `🏷️ カテゴリ: ${(r.categories || []).join(', ') || 'なし'}\n`;
      section += `🔧 ツール: ${(r.tools || []).join(', ') || 'なし'}\n\n`;

      // 追加するとDiscord制限を超えないか確認
      if ((header.length + body.length + section.length) > MAX_LEN) {
        break; // これ以上追加出来ない
      }
      body += section;
    }

    return header + body;
  }

  /**
   * セミナー検索結果をエンベッド用にフォーマット
   * @param query - 検索クエリ
   * @param results - ランク付けされたセミナーレコードの配列
   * @returns フォーマットされたエンベッド用テキスト
   */
  formatSearchResultsForEmbed(query: string, results: RankedSeminarRecord[]): string {
    try {
      // 検索結果がない場合
      if (!results || results.length === 0) {
        return `「${query}」に関連するセミナーが見つかりませんでした。`;
      }

      // 簡潔なフォーマット（エンベッド用）
      let formattedText = `「${query}」の検索結果（${results.length}件）:\n\n`;

      results.forEach((result, index) => {
        formattedText += `${index + 1}. **${result.title || '無題のセミナー'}**\n`;
      });

      return formattedText;
    } catch (error) {
      this.errorHandler.handle(error);
      return `「${query}」の検索結果をフォーマット中にエラーが発生しました。`;
    }
  }

  // 重複していたtruncateTextメソッドを削除しました

  /**
   * 検索結果が空の場合のフォールバックメッセージを生成
   * @param query - 検索クエリ
   * @param alternativeKeywords - 代替キーワードの配列
   * @returns フォールバックメッセージ
   */
  generateEmptyResultMessage(query: string, alternativeKeywords: string[] = []): string {
    let message = `申し訳ありませんが、「${query}」に関連するセミナーが見つかりませんでした。`;

    if (alternativeKeywords.length > 0) {
      message += '\n\n以下のキーワードで試してみてください:\n';
      alternativeKeywords.forEach(keyword => {
        message += `・${keyword}\n`;
      });
    } else {
      message += '\n\n別のキーワードで試してみてください。';
    }

    return message;
  }
}

export default Formatter;
