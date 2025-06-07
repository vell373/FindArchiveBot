import Logger from '../utils/Logger';

/**
 * キャッシュアイテムのインターフェース
 */
interface CacheItem<T> {
  data: T;
  expiresAt: number;
}

/**
 * メモリ内キャッシュを提供するサービス
 */
export default class CacheService {
  private cache: Map<string, CacheItem<any>>;
  private logger: Logger;
  private defaultTtl: number;

  /**
   * CacheServiceのコンストラクタ
   * @param defaultTtlMs デフォルトのキャッシュ有効期限（ミリ秒）
   */
  constructor(defaultTtlMs = 3600000) { // デフォルトは1時間
    this.cache = new Map();
    this.logger = new Logger('CacheService');
    this.defaultTtl = defaultTtlMs;
  }

  /**
   * キャッシュにデータを設定
   * @param key キャッシュキー
   * @param data キャッシュするデータ
   * @param ttlMs 有効期限（ミリ秒）
   */
  set<T>(key: string, data: T, ttlMs = this.defaultTtl): void {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt });
    
    this.logger.debug(`キャッシュ設定: ${key}`, {
      expiresIn: `${ttlMs / 1000}秒`,
      expiresAt: new Date(expiresAt).toISOString()
    });
  }

  /**
   * キャッシュからデータを削除
   * @param key キャッシュキー
   * @returns 削除に成功したかどうか
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    if (result) {
      this.logger.debug(`キャッシュ削除: ${key}`);
    }
    return result;
  }

  /**
   * キャッシュからデータを取得
   * @param key キャッシュキー
   * @returns キャッシュされたデータ、または未設定/期限切れの場合はundefined
   */
  get<T>(key: string): T | undefined {
    const item = this.cache.get(key);
    
    if (!item) {
      this.logger.debug(`キャッシュミス: ${key}`);
      return undefined;
    }
    
    // 期限切れチェック
    if (Date.now() > item.expiresAt) {
      this.logger.debug(`キャッシュ期限切れ: ${key}`, {
        expiresAt: new Date(item.expiresAt).toISOString()
      });
      this.cache.delete(key);
      return undefined;
    }
    
    this.logger.debug(`キャッシュヒット: ${key}`);
    return item.data as T;
  }



  /**
   * すべてのキャッシュをクリア
   */
  clear(): void {
    this.cache.clear();
    this.logger.info('キャッシュをクリアしました');
  }

  /**
   * 期限切れのキャッシュをすべて削除
   * @returns 削除されたキャッシュエントリの数
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.logger.info(`期限切れキャッシュを削除しました`, { count });
    }
    
    return count;
  }
}
