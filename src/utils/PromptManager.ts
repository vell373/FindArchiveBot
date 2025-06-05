import * as fs from 'fs';
import * as path from 'path';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * プロンプトファイルの管理を行うクラス
 */
export class PromptManager {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private promptDirectories: string[];

  /**
   * PromptManagerインスタンスを初期化
   */
  constructor() {
    this.logger = new Logger('PromptManager');
    this.errorHandler = new ErrorHandler('PromptManager');
    
    // 複数のプロンプトディレクトリを設定
    this.promptDirectories = [
      // 開発環境用パス
      path.resolve(process.cwd(), 'src/prompts'),
      // ビルド後のパス
      path.resolve(process.cwd(), 'dist/prompts'),
      // __dirnameからの相対パス（インポート先によって異なる）
      path.resolve(__dirname, '../prompts'),
      // プロダクション環境用のパス
      path.resolve(__dirname, '../../src/prompts')
    ];
    
    this.logger.info(`プロンプトディレクトリを設定: ${this.promptDirectories[0]}`);
  }

  /**
   * プロンプトファイルの内容を読み込む
   * @param promptFileName プロンプトファイル名
   * @returns プロンプトの内容
   */
  async getPromptContent(promptFileName: string): Promise<string> {
    try {
      // 各パスを試してファイルが存在するか確認
      for (const promptDir of this.promptDirectories) {
        const promptPath = path.resolve(promptDir, promptFileName);
        try {
          if (fs.existsSync(promptPath)) {
            this.logger.info(`プロンプトファイルを読み込みました: ${promptPath}`);
            return fs.readFileSync(promptPath, 'utf8');
          }
        } catch (e) {
          // このパスでの読み込みに失敗した場合は次のパスを試す
          continue;
        }
      }
      
      // すべてのパスで失敗した場合はエラーを投げる
      throw new Error(`プロンプトファイルが見つかりません: ${promptFileName}`);
    } catch (error) {
      this.logger.error(`プロンプトファイルの読み込みに失敗しました: ${promptFileName}`, { error });
      throw new AppError(
        ErrorType.UNKNOWN_ERROR,
        `プロンプトファイルの読み込みに失敗しました: ${promptFileName}`,
        error as Error
      );
    }
  }
}

// シングルトンインスタンスをエクスポート
export default new PromptManager();
