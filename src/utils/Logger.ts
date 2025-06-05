/**
 * ロギングユーティリティクラス
 */
export default class Logger {
  private component: string;

  /**
   * Loggerのコンストラクタ
   * @param component ログを出力するコンポーネント名
   */
  constructor(component: string) {
    this.component = component;
  }

  /**
   * 情報ログを出力
   * @param message ログメッセージ
   * @param data 追加データ（オプション）
   */
  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  /**
   * 警告ログを出力
   * @param message ログメッセージ
   * @param data 追加データ（オプション）
   */
  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  /**
   * エラーログを出力
   * @param message ログメッセージ
   * @param data 追加データ（オプション）
   */
  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }

  /**
   * デバッグログを出力
   * @param message ログメッセージ
   * @param data 追加データ（オプション）
   */
  debug(message: string, data?: any): void {
    // 環境変数でデバッグモードが有効な場合のみ出力
    if (process.env.LOG_LEVEL === 'DEBUG') {
      this.log('DEBUG', message, data);
    }
  }

  /**
   * ログを標準出力に出力
   * @param level ログレベル
   * @param message ログメッセージ
   * @param data 追加データ（オプション）
   */
  private log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      component: this.component,
      message,
      ...(data ? { data } : {})
    };

    console.log(JSON.stringify(logEntry));
  }
}
