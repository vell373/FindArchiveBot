import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * 検索結果のアイテムの型定義
 */
export interface NotionSearchResult {
  id: string;
  title: string;
  url?: string;
  summary?: string;
  tools?: string[];
  categories?: string[];
  [key: string]: unknown;
}

/**
 * 検索オプションの型定義
 */
export interface SearchOptions {
  limit?: number;
  sort?: 'relevance' | 'created_time' | 'last_edited_time';
  direction?: 'ascending' | 'descending';
  titleProperty?: string;
  summaryProperty?: string;
  toolsProperty?: string;
  categoriesProperty?: string;
}

/**
 * Notion MCP APIと連携するためのクラス
 */
export class NotionAdapter {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private client: AxiosInstance;
  private maxRetries: number;
  
  // デフォルトのプロパティ名
  private defaultTitleProperty = 'タイトル';
  private defaultSummaryProperty = '概要';
  private defaultToolsProperty = '使用ツール';
  private defaultCategoriesProperty = 'カテゴリ';

  /**
   * NotionAdapterインスタンスを初期化
   * @param apiKey - Notion MCP APIキー
   * @param baseUrl - API基本URL
   * @param maxRetries - 最大リトライ回数（デフォルト: 1）
   */
  constructor(
    apiKey: string,
    baseUrl: string,
    private databaseId: string,
    maxRetries = 1
  ) {
    this.logger = new Logger('NotionAdapter');
    this.errorHandler = new ErrorHandler('NotionAdapter');
    this.maxRetries = maxRetries;

    // データベースIDのフォーマットを確認
    this.logger.info(`使用するデータベースID: ${this.databaseId}`);

    // Axiosクライアントを設定
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Notion-Version': '2022-06-28', // Notion APIバージョンを指定
      },
      timeout: 10000, // 10秒
    });

    // レスポンスインターセプターを設定
    this.client.interceptors.response.use(
      (response: any) => response,
      (error: Error) => {
        this.logger.error('Notion MCP API エラー', error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * キーワードを使ってNotion MCPデータベースを検索
   * @param keywords - 検索キーワード配列
   * @param options - 検索オプション
   * @returns 検索結果の配列
   * @throws 検索に失敗した場合にエラー
   */
  async search(
    keywords: string[],
    options: SearchOptions = {}
  ): Promise<NotionSearchResult[]> {
    const query = keywords.join(' ');
    let retries = 0;
    let lastError: unknown;

    // 検索結果の上限を増やす
    const searchLimit = options.limit || 20; // デフォルトを5から20に増やす

    while (retries <= this.maxRetries) {
      try {
        this.logger.info(`Notionデータベース検索開始 (試行: ${retries + 1}/${this.maxRetries + 1})`, {
          query,
          keywords,
          options,
          searchLimit,
          databaseId: this.databaseId
        });

        const startTime = Date.now();
        
        // 検索キーワードを使用したフィルターを作成
        const titleProperty = options.titleProperty || this.defaultTitleProperty;
        const summaryProperty = options.summaryProperty || this.defaultSummaryProperty;
        
        this.logger.info(`使用するプロパティ名:`, {
          titleProperty,
          summaryProperty,
          defaultTitleProperty: this.defaultTitleProperty,
          defaultSummaryProperty: this.defaultSummaryProperty
        });
        
        // 検索条件を緩くするためのキーワードフィルターを作成
        const keywordFilters = [];
        
        // 各キーワードで検索条件を作成
        for (const keyword of keywords) {
          if (keyword.trim()) {
            // タイトルにキーワードが含まれる場合
            keywordFilters.push({
              property: titleProperty,
              title: {
                contains: keyword.trim()
              }
            });
            
            // 概要にキーワードが含まれる場合
            keywordFilters.push({
              property: summaryProperty,
              rich_text: {
                contains: keyword.trim()
              }
            });
          }
        }
        
        // 検索条件がない場合はクエリ全体で検索
        if (keywordFilters.length === 0) {
          keywordFilters.push({
            property: titleProperty,
            title: {
              contains: query
            }
          });
          
          keywordFilters.push({
            property: summaryProperty,
            rich_text: {
              contains: query
            }
          });
        }
        
        // 単語を分割して個別に検索するフィルターも追加
        const words = query.split(/\s+/).filter(word => word.length >= 2); // 2文字以上の単語を抽出
        
        for (const word of words) {
          // タイトルに単語が含まれる場合
          keywordFilters.push({
            property: titleProperty,
            title: {
              contains: word
            }
          });
          
          // 概要に単語が含まれる場合
          keywordFilters.push({
            property: summaryProperty,
            rich_text: {
              contains: word
            }
          });
        }
        
        this.logger.info(`検索キーワード:`, { keywords, query });
        
        // データベースクエリーの設定
        const requestData = {
          // 検索フィルター
          filter: {
            or: keywordFilters
          },
          // ページサイズを設定
          page_size: searchLimit
        };
        
        // NotionのデータベースクエリーAPIを呼び出す
        this.logger.info(`データベースクエリーリクエスト:`, {
          databaseId: this.databaseId,
          titleProperty,
          summaryProperty,
          requestData
        });
        
        let response;
        try {
          // APIリクエストを実行
          response = await this.client.post(`/databases/${this.databaseId}/query`, requestData);
          
          // レスポンスの詳細をログに出力
          this.logger.info(`データベースクエリーレスポンス:`, {
            status: response.status,
            statusText: response.statusText,
            hasResults: response.data && Array.isArray(response.data.results),
            resultCount: response.data && Array.isArray(response.data.results) ? response.data.results.length : 0
          });
        } catch (error) {
          // エラーの詳細をログに出力
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`データベースクエリーエラー: ${errorMessage}`);
          throw error;
        }
        
        const duration = Date.now() - startTime;
        
        // レスポンスを検証
        if (!response.data || !Array.isArray(response.data.results)) {
          throw new AppError(
            ErrorType.NOTION_MCP_ERROR,
            '無効なAPIレスポンス形式',
            undefined,
            500
          );
        }

        // 検索結果を整形
        const results = this.formatResults(response.data.results);
        
        this.logger.info(`Notion MCP検索完了`, {
          duration,
          resultCount: results.length,
        });

        return results;
      } catch (error) {
        lastError = error;
        retries++;
        
        // 最大リトライ回数に達した場合はエラーをスロー
        if (retries > this.maxRetries) {
          const appError = this.errorHandler.handle(error);
          throw appError;
        }
        
        // リトライ前に少し待機
        const delay = 1000; // 1秒
        this.logger.warn(`Notion MCP検索失敗、リトライします`, {
          retryCount: retries,
          delay,
          error: error instanceof Error ? error.message : String(error),
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // 予期せぬエラー（ここには到達しないはず）
    const appError = this.errorHandler.handle(lastError);
    throw appError;
  }

  /**
   * APIレスポンスから検索結果を整形
   * @param rawResults - APIからの生のレスポンス
   * @returns 整形された検索結果の配列
   */
  private formatResults(rawResults: any[]): NotionSearchResult[] {
    return rawResults.map(item => {
      // 必須プロパティの存在を確認
      const title = this.extractTitle(item);
      
      if (!title) {
        this.logger.warn('タイトルのないアイテムをスキップします', { item });
        return null;
      }

      // 結果オブジェクトを構築
      const result: NotionSearchResult = {
        id: item.id || `unknown-${Date.now()}`,
        title,
        url: this.extractUrl(item),
        summary: this.extractSummary(item),
        tools: this.extractMultiSelect(item, 'tools', '使用ツール'),
        categories: this.extractMultiSelect(item, 'categories', 'カテゴリ'),
      };

      // その他のプロパティがあれば追加
      Object.entries(item.properties || {}).forEach(([key, value]) => {
        if (!['title', 'url', 'summary', 'tools', 'categories'].includes(key.toLowerCase())) {
          result[key] = this.extractPropertyValue(value as any);
        }
      });

      return result;
    }).filter((item): item is NotionSearchResult => item !== null);
  }

  /**
   * アイテムからタイトルを抽出
   */
  private extractTitle(item: any): string {
    // 標準的なNotionのタイトルプロパティを探す
    if (item.properties?.[this.defaultTitleProperty]?.title) {
      return item.properties[this.defaultTitleProperty].title.map((t: any) => t.plain_text || '').join('');
    }
    
    // 日本語の「タイトル」プロパティを探す
    if (item.properties?.タイトル?.title) {
      return item.properties.タイトル.title.map((t: any) => t.plain_text || '').join('');
    }
    
    // 他の可能性のあるタイトルフィールドを探す
    for (const [key, value] of Object.entries(item.properties || {})) {
      if ((value as any)?.title) {
        return ((value as any).title as any[]).map((t: any) => t.plain_text || '').join('');
      }
    }
    
    // フォールバック: nameプロパティかitem自体の名前
    return item.name || item.title || '';
  }

  /**
   * アイテムからURLを抽出
   */
  private extractUrl(item: any): string | undefined {
    // URLプロパティを探す
    if (item.properties?.URL?.url) {
      return item.properties.URL.url;
    }
    
    // 日本語の「URL」プロパティを探す
    if (item.properties?.['URL']?.url) {
      return item.properties['URL'].url;
    }
    
    // 他の可能性のあるURLフィールドを探す
    for (const [key, value] of Object.entries(item.properties || {})) {
      if ((value as any)?.url) {
        return (value as any).url;
      }
    }
    
    return undefined;
  }

  /**
   * アイテムから概要を抽出
   */
  private extractSummary(item: any): string | undefined {
    // 概要プロパティを探す
    if (item.properties?.[this.defaultSummaryProperty]?.rich_text) {
      return item.properties[this.defaultSummaryProperty].rich_text.map((t: any) => t.plain_text || '').join('');
    }
    
    // 日本語の「概要」プロパティを探す
    if (item.properties?.概要?.rich_text) {
      return item.properties.概要.rich_text.map((t: any) => t.plain_text || '').join('');
    }
    
    // 他の可能性のあるテキストフィールドを探す
    for (const [key, value] of Object.entries(item.properties || {})) {
      if ((value as any)?.rich_text) {
        return ((value as any).rich_text as any[]).map((t: any) => t.plain_text || '').join('');
      }
    }
    
    return undefined;
  }

  /**
   * アイテムからマルチセレクトの値を抽出
   */
  private extractMultiSelect(item: any, englishName: string, japaneseName: string): string[] | undefined {
    // 英語名のプロパティを探す
    const propertyName = englishName === 'tools' ? this.defaultToolsProperty : 
                         englishName === 'categories' ? this.defaultCategoriesProperty : englishName;
    
    if (item.properties?.[propertyName]?.multi_select) {
      return item.properties[propertyName].multi_select.map((option: any) => option.name || '');
    }
    
    // 日本語名のプロパティを探す
    if (item.properties?.[japaneseName]?.multi_select) {
      return item.properties[japaneseName].multi_select.map((option: any) => option.name || '');
    }
    
    return undefined;
  }

  /**
   * プロパティの値を抽出
   */
  private extractPropertyValue(property: any): unknown {
    if (!property || !property.type) {
      return null;
    }

    switch (property.type) {
      case 'title':
      case 'rich_text':
        return property[property.type].map((t: any) => t.plain_text || '').join('');
      
      case 'number':
        return property.number;
      
      case 'select':
        return property.select?.name;
      
      case 'multi_select':
        return property.multi_select.map((option: any) => option.name || '');
      
      case 'date':
        return property.date?.start;
      
      case 'checkbox':
        return property.checkbox;
      
      case 'url':
        return property.url;
      
      case 'email':
        return property.email;
      
      case 'phone_number':
        return property.phone_number;
      
      default:
        return null;
    }
  }
}

export default NotionAdapter;
