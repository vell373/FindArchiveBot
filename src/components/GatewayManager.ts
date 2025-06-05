import WebSocket from 'ws';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * Discord Gateway OPコード
 */
enum GatewayOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  PRESENCE_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  REQUEST_GUILD_MEMBERS = 8,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/**
 * Discord Gateway イベントタイプ
 */
enum GatewayEventType {
  READY = 'READY',
  MESSAGE_CREATE = 'MESSAGE_CREATE',
  GUILD_CREATE = 'GUILD_CREATE',
  RESUMED = 'RESUMED',
}

/**
 * Gateway接続オプション
 */
interface GatewayOptions {
  token: string;
  intents: number;
  properties?: {
    os: string;
    browser: string;
    device: string;
  };
}

/**
 * Gateway接続状態
 */
enum ConnectionState {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
  RECONNECTING,
  RESUMING,
}

/**
 * Discord Gateway WebSocket接続を管理するクラス
 */
export class GatewayManager {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private ws: WebSocket | null = null;
  private options: GatewayOptions;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private sessionId: string | null = null;
  private sequence: number | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeatAck: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private gatewayUrl: string = 'wss://gateway.discord.gg/?v=10&encoding=json';
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  /**
   * GatewayManagerインスタンスを初期化
   * @param options - Gateway接続オプション
   */
  constructor(options: GatewayOptions) {
    this.logger = new Logger('GatewayManager');
    this.errorHandler = new ErrorHandler('GatewayManager');
    this.options = {
      ...options,
      properties: options.properties || {
        os: process.platform,
        browser: 'Notion MCP Discord Bot',
        device: 'Notion MCP Discord Bot',
      },
    };
  }

  /**
   * Discord Gateway WebSocketに接続
   * @returns 接続成功時はtrue
   */
  async connect(): Promise<boolean> {
    try {
      if (this.state !== ConnectionState.DISCONNECTED) {
        this.logger.warn(`既に接続中または接続試行中です (状態: ${ConnectionState[this.state]})`);
        return false;
      }

      this.state = ConnectionState.CONNECTING;
      this.logger.info('Discord Gatewayに接続します');

      // WebSocketインスタンスを作成
      this.ws = new WebSocket(this.gatewayUrl);

      // イベントリスナーを設定
      this.setupWebSocketListeners();

      // 接続が確立されるのを待機
      return await new Promise<boolean>((resolve, reject) => {
        // タイムアウト処理
        const connectionTimeout = setTimeout(() => {
          if (this.state !== ConnectionState.CONNECTED) {
            this.logger.error('接続タイムアウト');
            this.cleanup();
            reject(new AppError(
              ErrorType.NETWORK_ERROR,
              'Discord Gateway接続タイムアウト',
              undefined,
              408
            ));
          }
        }, 30000); // 30秒

        // 接続成功時の処理
        const onConnected = () => {
          clearTimeout(connectionTimeout);
          this.logger.info('Discord Gatewayに接続しました');
          resolve(true);
        };

        // 接続失敗時の処理
        const onError = (error: Error) => {
          clearTimeout(connectionTimeout);
          this.logger.error('接続エラー', error);
          this.cleanup();
          reject(error);
        };

        // イベントリスナーを一時的に追加
        this.once('connected', onConnected);
        this.once('error', onError);
      });
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      throw appError;
    }
  }

  /**
   * WebSocketイベントリスナーを設定
   */
  private setupWebSocketListeners(): void {
    if (!this.ws) return;

    // 接続オープン時
    this.ws.on('open', () => {
      this.logger.info('WebSocket接続が開きました');
      // この時点ではまだ認証していないので、CONNECTED状態ではない
    });

    // メッセージ受信時
    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const payload = JSON.parse(data.toString());
        this.handleGatewayPayload(payload);
      } catch (error) {
        this.logger.error('メッセージの解析に失敗しました', error instanceof Error ? error : new Error(String(error)));
      }
    });

    // エラー発生時
    this.ws.on('error', (error: Error) => {
      this.logger.error('WebSocketエラー', error);
      this.emit('error', error);
    });

    // 接続クローズ時
    this.ws.on('close', (code: number, reason: string) => {
      this.logger.warn(`WebSocket接続がクローズされました: コード=${code}, 理由=${reason}`);
      this.handleDisconnect(code, reason);
    });
  }

  /**
   * Gateway Payloadを処理
   * @param payload - 受信したペイロード
   */
  private handleGatewayPayload(payload: any): void {
    // シーケンス番号を更新（存在する場合）
    if (payload.s !== null) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case GatewayOpCode.HELLO:
        this.handleHello(payload);
        break;

      case GatewayOpCode.HEARTBEAT_ACK:
        this.handleHeartbeatAck();
        break;

      case GatewayOpCode.RECONNECT:
        this.logger.info('サーバーから再接続要求を受信しました');
        this.reconnect();
        break;

      case GatewayOpCode.INVALID_SESSION:
        this.handleInvalidSession(payload.d);
        break;

      case GatewayOpCode.DISPATCH:
        this.handleDispatch(payload);
        break;

      default:
        this.logger.debug(`未処理のOPコード: ${payload.op}`);
        break;
    }
  }

  /**
   * HELLO Payloadを処理
   * @param payload - HELLOペイロード
   */
  private handleHello(payload: any): void {
    const heartbeatInterval = payload.d.heartbeat_interval;
    this.logger.info(`HELLO受信: heartbeat_interval=${heartbeatInterval}ms`);

    // ハートビート間隔を設定
    this.setupHeartbeat(heartbeatInterval);

    // セッションIDがあればRESUME、なければIDENTIFY
    if (this.sessionId && this.sequence !== null && this.state === ConnectionState.RESUMING) {
      this.resume();
    } else {
      this.identify();
    }
  }

  /**
   * ハートビートを設定
   * @param interval - ハートビート間隔（ミリ秒）
   */
  private setupHeartbeat(interval: number): void {
    // 既存のハートビートをクリア
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 新しいハートビートを設定
    this.lastHeartbeatAck = true;
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  /**
   * ハートビートを送信
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 前回のハートビートに対するACKが来ていない場合は再接続
    if (!this.lastHeartbeatAck) {
      this.logger.warn('ハートビートACKが受信されませんでした、再接続します');
      this.reconnect();
      return;
    }

    // ハートビートを送信
    this.ws.send(JSON.stringify({
      op: GatewayOpCode.HEARTBEAT,
      d: this.sequence
    }));

    this.lastHeartbeatAck = false;
    this.logger.debug('ハートビート送信', { sequence: this.sequence });
  }

  /**
   * ハートビートACKを処理
   */
  private handleHeartbeatAck(): void {
    this.lastHeartbeatAck = true;
    this.logger.debug('ハートビートACK受信');
  }

  /**
   * IDENTIFY Payloadを送信
   */
  private identify(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.logger.info('IDENTIFYを送信します');

    // IDENTIFY Payloadを送信
    this.ws.send(JSON.stringify({
      op: GatewayOpCode.IDENTIFY,
      d: {
        token: this.options.token,
        intents: this.options.intents,
        properties: this.options.properties
      }
    }));
  }

  /**
   * RESUME Payloadを送信
   */
  private resume(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.sessionId || this.sequence === null) {
      this.logger.warn('セッションIDまたはシーケンス番号がないため、RESUMEできません');
      this.identify();
      return;
    }

    this.logger.info('RESUMEを送信します', { sessionId: this.sessionId, sequence: this.sequence });

    // RESUME Payloadを送信
    this.ws.send(JSON.stringify({
      op: GatewayOpCode.RESUME,
      d: {
        token: this.options.token,
        session_id: this.sessionId,
        seq: this.sequence
      }
    }));
  }

  /**
   * INVALID_SESSION Payloadを処理
   * @param resumable - セッションが再開可能かどうか
   */
  private handleInvalidSession(resumable: boolean): void {
    this.logger.warn(`無効なセッション: resumable=${resumable}`);

    if (resumable) {
      // 少し待ってからRESUME
      setTimeout(() => {
        this.resume();
      }, 2000 + Math.random() * 3000);
    } else {
      // セッション情報をクリアして再認証
      this.sessionId = null;
      this.sequence = null;
      
      // 少し待ってからIDENTIFY
      setTimeout(() => {
        this.identify();
      }, 2000 + Math.random() * 3000);
    }
  }

  /**
   * DISPATCH Payloadを処理
   * @param payload - DISPATCHペイロード
   */
  private handleDispatch(payload: any): void {
    const { t: eventType, d: eventData } = payload;

    this.logger.debug(`イベント受信: ${eventType}`);

    // READYイベントを処理
    if (eventType === GatewayEventType.READY) {
      this.handleReady(eventData);
    }
    
    // RESUMEDイベントを処理
    if (eventType === GatewayEventType.RESUMED) {
      this.handleResumed();
    }

    // 登録されたハンドラーにイベントを通知
    if (this.messageHandlers.has(eventType)) {
      const handler = this.messageHandlers.get(eventType);
      if (handler) {
        handler(eventData);
      }
    }

    // 一般的なメッセージイベントを発行
    this.emit('message', { type: eventType, data: eventData });
  }

  /**
   * READYイベントを処理
   * @param data - READYイベントデータ
   */
  private handleReady(data: any): void {
    this.sessionId = data.session_id;
    this.state = ConnectionState.CONNECTED;
    
    this.logger.info('READY受信', {
      user: `${data.user.username}#${data.user.discriminator}`,
      sessionId: this.sessionId,
    });

    // 接続完了イベントを発行
    this.emit('connected', data);
  }

  /**
   * RESUMEDイベントを処理
   */
  private handleResumed(): void {
    this.state = ConnectionState.CONNECTED;
    this.logger.info('セッションを再開しました');
    
    // 再開完了イベントを発行
    this.emit('resumed');
  }

  /**
   * 切断を処理
   * @param code - 切断コード
   * @param reason - 切断理由
   */
  private handleDisconnect(code: number, reason: string): void {
    this.cleanup();

    // 正常な切断の場合は再接続しない
    if (code === 1000) {
      this.logger.info('正常に切断されました');
      this.state = ConnectionState.DISCONNECTED;
      this.emit('disconnected', { code, reason });
      return;
    }

    // 再接続可能なコードの場合は再接続
    this.logger.warn(`異常切断: コード=${code}, 理由=${reason}`);
    this.reconnect();
  }

  /**
   * 再接続を試みる
   */
  private reconnect(): void {
    if (this.state === ConnectionState.RECONNECTING) {
      return;
    }

    this.state = ConnectionState.RECONNECTING;
    this.cleanup();

    // 指数バックオフで再接続
    const delay = Math.floor(Math.random() * 5000) + 1000;
    this.logger.info(`${delay}ms後に再接続します`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        if (this.sessionId && this.sequence !== null) {
          this.state = ConnectionState.RESUMING;
        }
        await this.connect();
      } catch (error) {
        this.logger.error('再接続に失敗しました', error instanceof Error ? error : new Error(String(error)));
        this.reconnect();
      }
    }, delay);
  }

  /**
   * リソースをクリーンアップ
   */
  private cleanup(): void {
    // WebSocketをクローズ
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        this.logger.error('WebSocketのクローズに失敗しました', error instanceof Error ? error : new Error(String(error)));
      }
      this.ws = null;
    }

    // ハートビートをクリア
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 再接続タイムアウトをクリア
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * 切断
   */
  disconnect(): void {
    this.logger.info('切断します');
    this.state = ConnectionState.DISCONNECTED;
    this.cleanup();
    this.emit('disconnected', { code: 1000, reason: 'User requested disconnect' });
  }

  /**
   * メッセージハンドラーを登録
   * @param eventType - イベントタイプ
   * @param handler - ハンドラー関数
   */
  onMessage(eventType: string, handler: (data: any) => void): void {
    this.messageHandlers.set(eventType, handler);
    this.logger.debug(`メッセージハンドラーを登録: ${eventType}`);
  }

  /**
   * メッセージハンドラーを削除
   * @param eventType - イベントタイプ
   */
  offMessage(eventType: string): void {
    this.messageHandlers.delete(eventType);
    this.logger.debug(`メッセージハンドラーを削除: ${eventType}`);
  }

  /**
   * イベントリスナーを一度だけ実行するように登録
   * @param event - イベント名
   * @param listener - リスナー関数
   */
  private once(event: string, listener: (...args: any[]) => void): void {
    const onceListener = (...args: any[]) => {
      this.off(event, onceListener);
      listener(...args);
    };
    
    this.on(event, onceListener);
  }

  /**
   * イベントリスナーを登録
   * @param event - イベント名
   * @param listener - リスナー関数
   */
  private on(event: string, listener: (...args: any[]) => void): void {
    if (!this._events) this._events = {};
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
  }

  /**
   * イベントリスナーを削除
   * @param event - イベント名
   * @param listener - リスナー関数
   */
  private off(event: string, listener: (...args: any[]) => void): void {
    if (!this._events || !this._events[event]) return;
    this._events[event] = this._events[event].filter((l: any) => l !== listener);
  }

  /**
   * イベントを発行
   * @param event - イベント名
   * @param args - イベント引数
   */
  private emit(event: string, ...args: any[]): void {
    if (!this._events || !this._events[event]) return;
    this._events[event].forEach((listener: any) => {
      try {
        listener(...args);
      } catch (error) {
        this.logger.error(`イベントリスナーでエラーが発生しました: ${event}`, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  // イベントリスナーを格納するプライベートプロパティ
  private _events: Record<string, ((...args: any[]) => void)[]> = {};
}

export default GatewayManager;
