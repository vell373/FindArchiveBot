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
    const queryOnce = async (strictAnd: boolean) => {
      const filter: any = { and: [] };

      // カテゴリフィルタ
      if (categories.length > 0) {
        if (strictAnd && categories.length > 1) {
          // すべてのカテゴリを含むレコードのみ
          categories.forEach(cat => {
            filter.and.push({
              property: 'カテゴリ',
              multi_select: { contains: cat }
            });
          });
        } else {
          const orList = categories.map(cat => ({
            property: 'カテゴリ',
            multi_select: { contains: cat }
          }));
          filter.and.push({ or: orList });
        }
      }

      // ツールフィルタ
      if (tools.length > 0) {
        if (strictAnd && tools.length > 1) {
          tools.forEach(tool => {
            filter.and.push({
              property: '使用ツール',
              multi_select: { contains: tool }
            });
          });
        } else {
          const orList = tools.map(tool => ({
            property: '使用ツール',
            multi_select: { contains: tool }
          }));
          filter.and.push({ or: orList });
        }
      }

      // キーワードフィルタ
      if (keywords.length > 0) {
        const keywordFilters = keywords.flatMap(k => ([
          { property: 'タイトル', rich_text: { contains: k } },
          { property: '概要',   rich_text: { contains: k } }
        ]));
        filter.and.push({ or: keywordFilters });
      }

      const resp = await this.client.databases.query({
        database_id: this.databaseId,
        filter: filter.and.length > 0 ? filter : undefined,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 50
      });
      return resp.results.map((p: any) => this.convertPageToSeminarRecord(p as PageObjectResponse));
    };
    try {
      // 1. 厳格モード (AND) で検索
      let results: SeminarRecord[] = await queryOnce(true);

      // 10件未満の場合、緩和モード (OR) で追加取得
      if (results.length < 10) {
        const relaxed = await queryOnce(false);
        const seen = new Set(results.map(r => r.id));
        relaxed.forEach(r => {
          if (!seen.has(r.id)) results.push(r);
        });
      }

      return results;
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
  /**
   * メンション検索専用 3フェーズ検索ロジック
   * 1. カテゴリ & ツール AND (キーワード無視)
   * 2. カテゴリ / ツール OR  (キーワード無視)
   * 3. OR + タイトル/概要 キーワード
   */
  async searchSeminarsPhased(
    keywords: string[],
    categories: string[] = [],
    tools: string[] = []
  ): Promise<SeminarRecord[]> {
    const queryPhase = async (strictAnd: boolean, includeKeywords: boolean): Promise<SeminarRecord[]> => {
      const filter: any = { and: [] };

      // カテゴリフィルタ
      if (categories.length > 0) {
        if (strictAnd && categories.length > 1) {
          categories.forEach(cat => {
            filter.and.push({ property: 'カテゴリ', multi_select: { contains: cat } });
          });
        } else {
          const orList = categories.map(cat => ({ property: 'カテゴリ', multi_select: { contains: cat } }));
          filter.and.push({ or: orList });
        }
      }

      // ツールフィルタ
      if (tools.length > 0) {
        if (strictAnd && tools.length > 1) {
          tools.forEach(tool => {
            filter.and.push({ property: '使用ツール', multi_select: { contains: tool } });
          });
        } else {
          const orList = tools.map(tool => ({ property: '使用ツール', multi_select: { contains: tool } }));
          filter.and.push({ or: orList });
        }
      }

      // キーワード (タイトル / 概要)
      if (includeKeywords && keywords.length > 0) {
        const keywordFilters = keywords.flatMap(k => ([
          { property: 'タイトル', rich_text: { contains: k } },
          { property: '概要',   rich_text: { contains: k } }
        ]));
        filter.and.push({ or: keywordFilters });
      }

      const resp = await this.client.databases.query({
        database_id: this.databaseId,
        filter: filter.and.length > 0 ? filter : undefined,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 50
      });
      return resp.results.map((p: any) => this.convertPageToSeminarRecord(p as PageObjectResponse));
    };

    // カテゴリ・ツール未指定の場合はキーワードから一致するカテゴリ/ツールを推定
    if (categories.length === 0 && tools.length === 0 && keywords.length > 0) {
      try {
        const allCategories = await this.getCategories().catch(() => []);
        const allTools = await this.getTools().catch(() => []);

        const derivedCategories = allCategories.filter(cat =>
          keywords.some(k => cat.includes(k) || k.includes(cat))
        );
        const derivedTools = allTools.filter(tool =>
          keywords.some(k => tool.includes(k) || k.includes(tool))
        );

        if (derivedCategories.length > 0 || derivedTools.length > 0) {
          categories = derivedCategories;
          tools = derivedTools;
          this.logger.info('推定カテゴリ/ツールを適用', { derivedCategories, derivedTools });
        }
      } catch (error) {
        this.logger.error('派生カテゴリ/ツール取得エラー', { error });
      }
    }

    // カテゴリ・ツールが最終的に空の場合は、キーワードを含めた検索のみを実行（メンション検索で過剰ヒットを防止）
    if (categories.length === 0 && tools.length === 0) {
      return await queryPhase(false, true);
    }

    try {
      const results: SeminarRecord[] = [];
      const seen = new Set<string>();
      const addUnique = (list: SeminarRecord[]) => {
        list.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); results.push(r); } });
      };

      addUnique(await queryPhase(true, false));
      if (results.length < 10) addUnique(await queryPhase(false, false));
      if (results.length < 10) addUnique(await queryPhase(false, true));

      return results;
    } catch (error) {
      this.logger.error('メンション検索フェーズエラー', { error, keywords, categories, tools });
      throw error;
    }
  }

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
