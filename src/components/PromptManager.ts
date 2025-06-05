import fs from 'fs';
import path from 'path';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * プロンプトの種類を定義する列挙型
 */
export enum PromptType {
  SEARCH = 'search_prompt.txt',
  ANSWER = 'answer_prompt.txt',
}

/**
 * プロンプトファイルの読み込みと管理を担当するクラス
 */
export class PromptManager {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private promptsDir: string;
  private promptCache: Map<PromptType, { content: string; lastModified: number }>;
  private cacheTimeout: number;

  /**
   * PromptManagerインスタンスを初期化
   * @param promptsDir - プロンプトファイルが格納されているディレクトリパス
   * @param cacheTimeoutMs - キャッシュの有効期限（ミリ秒）
   */
  constructor(
    promptsDir?: string,
    cacheTimeoutMs = 60000 // デフォルト: 60秒
  ) {
    this.logger = new Logger('PromptManager');
    this.errorHandler = new ErrorHandler('PromptManager');
    this.promptsDir = promptsDir || path.join(process.cwd(), 'src', 'prompts');
    this.promptCache = new Map();
    this.cacheTimeout = cacheTimeoutMs;
    
    this.logger.info(`プロンプトディレクトリを設定: ${this.promptsDir}`);
  }

  /**
   * 指定されたプロンプトタイプのファイルを読み込む
   * @param type - 読み込むプロンプトの種類
   * @returns プロンプトの内容
   * @throws プロンプトファイルが存在しない場合やアクセスできない場合にエラー
   */
  async getPrompt(type: PromptType): Promise<string> {
    try {
      const now = Date.now();
      const cached = this.promptCache.get(type);

      // キャッシュが有効な場合はキャッシュから返す
      if (cached && now - cached.lastModified < this.cacheTimeout) {
        this.logger.debug(`キャッシュからプロンプトを取得: ${type}`);
        return cached.content;
      }

      // プロンプトファイルのパスを構築
      const promptPath = path.join(this.promptsDir, type);
      
      // ファイルが存在するか確認
      if (!fs.existsSync(promptPath)) {
        throw new AppError(
          ErrorType.VALIDATION_ERROR,
          `プロンプトファイルが見つかりません: ${promptPath}`,
          undefined,
          404
        );
      }

      // ファイルを読み込む
      const content = await fs.promises.readFile(promptPath, 'utf-8');
      
      // キャッシュを更新
      this.promptCache.set(type, { content, lastModified: now });
      
      this.logger.info(`プロンプトを読み込みました: ${type}`);
      return content;
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      throw appError;
    }
  }

  /**
   * 検索用プロンプトを取得し、質問を埋め込む
   * @param question - ユーザーからの質問
   * @returns 質問が埋め込まれた検索用プロンプト
   */
  async getSearchPrompt(question: string): Promise<string> {
    const prompt = await this.getPrompt(PromptType.SEARCH);
    return prompt.replace('{QUESTION}', question);
  }

  /**
   * 回答用プロンプトを取得し、質問と検索結果を埋め込む
   * @param question - ユーザーからの質問
   * @param results - 検索結果（JSON文字列）
   * @returns 質問と検索結果が埋め込まれた回答用プロンプト
   */
  async getAnswerPrompt(question: string, results: string): Promise<string> {
    const prompt = await this.getPrompt(PromptType.ANSWER);
    return prompt
      .replace('{QUESTION}', question)
      .replace('{RESULTS_JSON}', results);
  }

  /**
   * プロンプトキャッシュをクリア
   */
  clearCache(): void {
    this.promptCache.clear();
    this.logger.info('プロンプトキャッシュをクリアしました');
  }
}

export default PromptManager;
