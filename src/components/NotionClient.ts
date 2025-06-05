import { Client } from '@notionhq/client';
import { DatabaseObjectResponse, PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { SeminarRecord } from '../models/SeminarRecord';
import Logger from '../utils/Logger';

/**
 * Notion APIと連携するクライアントクラス
 */
export default class NotionClient {
  private client: Client;
  private databaseId: string;
  private logger: Logger;

  /**
   * NotionClientのコンストラクタ
   * @param apiKey Notion API Key
   * @param databaseId 検索対象のデータベースID
   */
  constructor(apiKey: string, databaseId: string) {
    this.client = new Client({ auth: apiKey });
    this.databaseId = databaseId;
    this.logger = new Logger('NotionClient');
  }

  /**
   * カテゴリ一覧を取得
   * @returns カテゴリの配列
   */
  async getCategories(): Promise<string[]> {
    try {
      const response = await this.client.databases.retrieve({
        database_id: this.databaseId
      });

      // カテゴリプロパティからオプションを抽出
      const properties = response.properties as Record<string, any>;
      const categoryProperty = Object.values(properties).find(
        (prop: any) => prop.type === 'multi_select' && prop.name === 'カテゴリ'
      );

      if (categoryProperty && categoryProperty.type === 'multi_select') {
        return categoryProperty.multi_select.options.map((option: any) => option.name);
      }

      return [];
    } catch (error) {
      this.logger.error('カテゴリ取得エラー', { error });
      return [];
    }
  }

  /**
   * ツール一覧を取得
   * @returns ツールの配列
   */
  async getTools(): Promise<string[]> {
    try {
      const response = await this.client.databases.retrieve({
        database_id: this.databaseId
      });
      
      // ツールプロパティからオプションを抽出
      const properties = response.properties as Record<string, any>;
      const toolProperty = Object.values(properties).find(
        (prop: any) => prop.type === 'multi_select' && prop.name === '使用ツール'
      );
      
      if (toolProperty && toolProperty.type === 'multi_select') {
        return toolProperty.multi_select.options.map((option: any) => option.name);
      }
      
      return [];
    } catch (error) {
      this.logger.error('ツール取得エラー', { error });
      return [];
    }
  }

  /**
   * キーワードとフィルタ条件に基づいてセミナーを検索
   * @param keywords 検索キーワード
   * @param categories カテゴリフィルタ
   * @param tools ツールフィルタ
   * @returns 検索結果のセミナーレコード配列
   */
  async searchSeminars(
    keywords: string[],
    categories: string[] = [],
    tools: string[] = []
  ): Promise<SeminarRecord[]> {
    try {
      // フィルタ条件の構築
      const filter: any = {
        and: []
      };

      // カテゴリフィルタ（選択されている場合のみ）
      if (categories.length > 0) {
        filter.and.push({
          property: 'カテゴリ',
          multi_select: {
            contains: categories[0] // 最初のカテゴリで検索
          }
        });
      }

      // ツールフィルタ（選択されている場合のみ）
      if (tools.length > 0) {
        filter.and.push({
          property: '使用ツール',
          multi_select: {
            contains: tools[0] // 最初のツールで検索
          }
        });
      }

      // キーワードフィルタ
      if (keywords.length > 0) {
        const keywordFilters = keywords.map(keyword => ({
          property: 'title',
          rich_text: {
            contains: keyword
          }
        }));

        filter.and.push({
          or: keywordFilters
        });
      }

      // 検索実行
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: filter.and.length > 0 ? filter : undefined,
        sorts: [
          {
            timestamp: 'last_edited_time',
            direction: 'descending'
          }
        ],
        page_size: 20 // 最大20件取得
      });

      // 検索結果をSeminarRecordに変換
      return response.results.map((page: any) => this.convertPageToSeminarRecord(page as PageObjectResponse));
    } catch (error) {
      this.logger.error('検索エラー', { error, keywords, categories, tools });
      throw error;
    }
  }

  /**
   * Notionのページオブジェクトをセミナーレコードに変換
   * @param page Notionページオブジェクト
   * @returns 変換されたセミナーレコード
   */
  private convertPageToSeminarRecord(page: PageObjectResponse): SeminarRecord {
    try {
      const properties = page.properties as Record<string, any>;
      
      // タイトル取得
      const titleProp = properties['タイトル'] || {};
      const title = titleProp.title?.map((t: any) => t.plain_text).join('') || '無題';
      
      // 説明取得
      const descProp = properties['概要'] || {};
      const description = descProp.rich_text?.map((t: any) => t.plain_text).join('') || '';
      
      // URL取得
      const urlProp = properties['URL'] || {};
      const url = urlProp.url || '';
      
      // カテゴリ取得
      const catProp = properties['カテゴリ'] || {};
      const categories = catProp.multi_select?.map((c: any) => c.name) || [];
      
      // ツール取得
      const toolProp = properties['使用ツール'] || {};
      const tools = toolProp.multi_select?.map((t: any) => t.name) || [];
      
      // 開催日取得
      const dateProp = properties['開催日'] || {};
      const eventDate = dateProp.date?.start || '';
      
      // 更新日時取得
      const updatedProp = properties['updated'] || {};
      const updated = updatedProp.date?.start || page.last_edited_time || '';

      // サムネイル取得（YouTubeなど）
      const thumbProp = properties['サムネイル'] || {};
      const thumbnailUrl = thumbProp.files?.[0]?.file?.url || 
                        thumbProp.files?.[0]?.external?.url || '';

      return {
        id: page.id,
        title,
        description,
        url,
        categories,
        tools,
        eventDate,
        updated,
        thumbnailUrl
      };
    } catch (error) {
      this.logger.error('ページ変換エラー', { error, pageId: page.id });

      // エラー時は最低限の情報を返す
      return {
        id: page.id,
        title: '変換エラー',
        description: '',
        url: '',
        categories: [],
        tools: [],
        eventDate: '',
        updated: '',
        thumbnailUrl: ''
      };
    }
  }
}
