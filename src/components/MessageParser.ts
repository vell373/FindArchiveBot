import { Message } from 'discord.js';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * Discordメッセージの解析を担当するクラス
 */
export class MessageParser {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private botId: string | null = null;

  /**
   * MessageParserインスタンスを初期化
   * @param botId - BotのユーザーID（オプション）
   */
  constructor(botId?: string) {
    this.logger = new Logger('MessageParser');
    this.errorHandler = new ErrorHandler('MessageParser');
    if (botId) {
      this.botId = botId;
    }
  }

  /**
   * BotのIDを設定
   * @param botId - 設定するBotのID
   */
  setBotId(botId: string): void {
    this.botId = botId;
    this.logger.info('BotIDが設定されました', { botId });
  }

  /**
   * メッセージがBotへのメンションを含むかどうかを判定
   * @param message - Discordメッセージオブジェクト
   * @returns Botへのメンションを含む場合はtrue
   */
  isMentioningBot(message: Message): boolean {
    // BotIDが設定されていない場合はメンションされていないと判断
    if (!this.botId) {
      this.logger.warn('BotIDが設定されていないため、メンションを判定できません');
      return false;
    }

    // @here や @everyone へのメンションは無視
    if (message.mentions.everyone) {
      return false;
    }

    // メッセージがBotをメンションしているか確認
    return message.mentions.users.has(this.botId);
  }

  /**
   * メッセージから質問テキストを抽出
   * @param message - Discordメッセージオブジェクト
   * @returns 抽出された質問テキスト
   * @throws 質問テキストが空または無効な場合にエラー
   */
  extractQuestion(message: Message): string | null {
    try {
      // Botがメンションされていない場合はnullを返す
      if (!this.isMentioningBot(message)) {
        return null;
      }
      
      // メンションを除去してテキストを抽出
      let content = message.content;
      
      // すべてのユーザーメンションを除去
      message.mentions.users.forEach((user) => {
        const userMention = `<@${user.id}>`;
        const userMentionNickname = `<@!${user.id}>`;
        content = content.replace(userMention, '').replace(userMentionNickname, '');
      });
      
      // 余分な空白を削除して整形
      const question = this.stripMarkdown(content.trim());
      
      // 質問が空でないことを確認
      if (!question) {
        this.logger.info('メンション後に質問がありません');
        return null;
      }
      
      this.logger.info('質問を抽出しました', { question });
      return question;
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      throw appError;
    }
  }

  /**
   * テキストからMarkdown記法を除去
   * @param text - 処理するテキスト
   * @returns Markdown記法が除去されたテキスト
   */
  stripMarkdown(text: string): string {
    // コードブロックを除去
    text = text.replace(/```[\s\S]*?```/g, '');
    
    // インラインコードを除去
    text = text.replace(/`[^`]*`/g, '');
    
    // 太字と斜体を除去
    text = text.replace(/\*\*([^*]*)\*\*/g, '$1');
    text = text.replace(/\*([^*]*)\*/g, '$1');
    text = text.replace(/__([^_]*)__/g, '$1');
    text = text.replace(/_([^_]*)_/g, '$1');
    
    // URLを除去
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    
    // 引用を除去
    text = text.replace(/^>\s(.*)$/gm, '$1');
    
    // 余分な空白を削除
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  /**
   * メッセージの長さが適切かどうかを確認
   * @param text - 確認するテキスト
   * @param minLength - 最小文字数（デフォルト: 3）
   * @param maxLength - 最大文字数（デフォルト: 1000）
   * @returns 長さが適切な場合はtrue
   */
  isValidQuestionLength(text: string, minLength = 3, maxLength = 1000): boolean {
    return text.length >= minLength && text.length <= maxLength;
  }
}

export default MessageParser;
