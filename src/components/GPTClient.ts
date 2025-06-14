import { OpenAI } from 'openai';
import Logger from '../utils/Logger';
import ErrorHandler, { AppError, ErrorType } from '../utils/ErrorHandler';
import { SeminarRecord, RankedSeminarRecord } from '../models/SeminarRecord';
import { SearchQuery } from '../models/SearchQuery';
import PromptManager from '../utils/PromptManager';

/**
 * OpenAIのChat Completion APIを利用するためのクラス
 */
export class GPTClient {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private openai: OpenAI;
  private maxRetries: number;
  private retryDelay: number;
  private defaultModel: string;
  private keywordModel: string;
  private rankingModel: string;
  private maxTokens: number;

  /**
   * GPTClientインスタンスを初期化
   * @param apiKey - OpenAI APIキー
   * @param maxRetries - 最大リトライ回数（デフォルト: 3）
   * @param retryDelay - リトライ間隔（ミリ秒、デフォルト: 1000）
   */
  constructor(
    apiKey: string,
    maxRetries = 3,
    retryDelay = 1000,
    defaultModel = 'gpt-3.5-turbo',
    keywordModel = 'gpt-3.5-turbo-0125',
    rankingModel = 'gpt-3.5-turbo-0125'
  ) {
    this.logger = new Logger('GPTClient');
    this.errorHandler = new ErrorHandler('GPTClient');
    this.openai = new OpenAI({ apiKey });
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
    
    // 環境変数からモデルとパラメータを取得（設定されていない場合はデフォルト値を使用）
    this.defaultModel = process.env.OPENAI_DEFAULT_MODEL || defaultModel;
    this.keywordModel = process.env.OPENAI_KEYWORD_MODEL || keywordModel;
    this.rankingModel = process.env.OPENAI_RANKING_MODEL || rankingModel;
    this.maxTokens = process.env.OPENAI_MAX_TOKENS ? parseInt(process.env.OPENAI_MAX_TOKENS) : 4000;
    
    this.logger.info('GPTClientを初期化しました', {
      defaultModel: this.defaultModel,
      keywordModel: this.keywordModel,
      rankingModel: this.rankingModel,
      maxTokens: this.maxTokens
    });
  }

  /**
   * OpenAI Chat Completion APIを呼び出す
   * @param prompt - 送信するプロンプト
   * @param model - 使用するモデル（デフォルト: gpt-3.5-turbo）
   * @returns APIからの応答テキスト
   * @throws API呼び出しに失敗した場合にエラー
   */
  async complete(
    prompt: string,
    model = this.defaultModel
  ): Promise<string> {
    let retries = 0;
    let lastError: unknown;

    while (retries <= this.maxRetries) {
      try {
        this.logger.info(`OpenAI APIリクエスト開始 (試行: ${retries + 1}/${this.maxRetries + 1})`, {
          model,
          promptLength: prompt.length,
        });

        const startTime = Date.now();
        
        // OpenAI APIを呼び出す
        const response = await this.openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2, // 温度パラメーターを下げて出力の一貫性を高める
          max_tokens: this.maxTokens, // 環境変数から設定された最大トークン数を使用
        });

        const duration = Date.now() - startTime;
        
        // 応答からテキストを抽出
        const content = response.choices[0]?.message?.content?.trim();
        
        if (!content) {
          throw new AppError(
            ErrorType.OPENAI_ERROR,
            'OpenAI APIからの応答が空です',
            undefined,
            500
          );
        }

        this.logger.info(`OpenAI APIリクエスト完了`, {
          duration,
          tokensUsed: response.usage?.total_tokens,
        });

        return content;
      } catch (error) {
        lastError = error;
        retries++;
        
        // 最大リトライ回数に達した場合はエラーをスロー
        if (retries > this.maxRetries) {
          const appError = this.errorHandler.handle(error);
          throw appError;
        }
        
        // 指数バックオフでリトライ
        const delay = this.retryDelay * Math.pow(2, retries - 1);
        this.logger.warn(`OpenAI APIリクエスト失敗、リトライします`, {
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
   * ユーザーの検索クエリからキーワードを抽出
   * @param searchQuery 検索クエリ
   * @returns 抽出されたキーワードの配列
   */
  async extractKeywords(searchQuery: SearchQuery): Promise<string[]> {
    try {
      const { queryText, categories, tools } = searchQuery;
      
      const prompt = `
# ROLE
You are a concise keyword extractor.
# INPUT
UserQuery: "${queryText}"
Categories: ${JSON.stringify(categories)}
Tools: ${JSON.stringify(tools)}
# RULES
- Output a JSON array (max 5 items) of Japanese keywords.
- Use single- or double-byte words as appropriate.
- Do NOT add commentary.
      `;
      
      const response = await this.complete(prompt, this.keywordModel);
      
      try {
        // JSONとして解析
        const keywords = JSON.parse(response);
        
        if (Array.isArray(keywords) && keywords.length > 0) {
          return keywords.slice(0, 5); // 最大5つまで
        }
        
        throw new Error('キーワード抽出の結果が配列ではありません');
      } catch (parseError) {
        this.logger.warn('キーワード抽出の結果をJSONとして解析できませんでした', { response });
        
        // フォールバック: 行ごとに分割して処理
        const fallbackKeywords = response
          .split(/[\n,\[\]"]/)
          .map(k => k.trim())
          .filter(k => k.length > 0)
          .slice(0, 5);
        
        if (fallbackKeywords.length > 0) {
          return fallbackKeywords;
        }
        
        throw new AppError(
          ErrorType.VALIDATION_ERROR,
          'キーワードを抽出できませんでした',
          parseError instanceof Error ? parseError : undefined
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.errorHandler.handle(error);
    }
  }

  /**
   * 検索結果をランク付け
   * @param searchQuery 検索クエリ
   * @param searchResults 検索結果
   * @returns ランク付けされた検索結果
   */
  async rankSearchResults(
    searchQuery: SearchQuery,
    searchResults: SeminarRecord[]
  ): Promise<RankedSeminarRecord[]> {
    if (searchResults.length === 0) {
      return [];
    }
    
    if (searchResults.length === 1) {
      // 結果が1つだけの場合は最高スコアを付けて返す
      return [{
        ...searchResults[0],
        score: 1.0,
        reason: '唯一の検索結果'
      }];
    }
    
    try {
      // プロンプトファイルから読み込み
      let promptContent = await PromptManager.getPromptContent('ranking_prompt.txt');
      
      // 検索結果をJSONL形式に変換
      const jsonlResults = searchResults.map(result => JSON.stringify(result)).join('\n');
      
      // プレースホルダーを置換
      const prompt = promptContent
        .replace('{QUERY}', searchQuery.queryText)
        .replace('{JSONL}', jsonlResults);
      
      const response = await this.complete(prompt, this.rankingModel);
      
      try {
        // JSONとして解析
        const rankings = JSON.parse(response);
        
        if (!Array.isArray(rankings)) {
          throw new Error('ランキング結果が配列ではありません');
        }
        
        // ランキング結果と元の検索結果をマージ
        const rankedResults: RankedSeminarRecord[] = [];
        
        for (const rank of rankings) {
          const seminar = searchResults.find(r => r.id === rank.id);
          if (seminar) {
            rankedResults.push({
              ...seminar,
              score: typeof rank.score === 'number' ? rank.score : 0,
              reason: rank.reason || ''
            });
          }
        }
        
        // 選択カテゴリ・ツールをすべて含むレコードにボーナス付与
        const { categories: selCats = [], tools: selTools = [] } = searchQuery;
        rankedResults.forEach(r => {
          const catMatch = selCats.length > 0 && selCats.every(c => (r.categories || []).includes(c));
          const toolMatch = selTools.length > 0 && selTools.every(t => (r.tools || []).includes(t));
          if (catMatch || toolMatch) {
            r.score += 0.2; // ボーナス
          }
          if (catMatch && toolMatch) {
            r.score += 0.1; // 両方満たす場合さらに加点
          }
        });

        // スコア順にソート
        return rankedResults.sort((a, b) => b.score - a.score);
      } catch (parseError) {
        this.logger.warn('ランキング結果をJSONとして解析できませんでした', { response });
        
        // フォールバック: 最初の5件をそのまま返す
        return searchResults.slice(0, 5).map((result, index) => ({
          ...result,
          score: 1 - (index * 0.1), // 順番に応じてスコアを下げる
          reason: 'フォールバックランキング'
        }));
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.errorHandler.handle(error);
    }
  }

  /**
   * 検索結果が0件の場合に代替キーワードを提案
   * @param searchQuery 検索クエリ
   * @returns 代替キーワードの配列
   */
  async suggestAlternativeKeywords(searchQuery: SearchQuery): Promise<string[]> {
    try {
      // プロンプトファイルから読み込み
      let promptContent = await PromptManager.getPromptContent('alternative_keywords_prompt.txt');
      
      // プレースホルダーを置換
      const prompt = promptContent.replace('{QUERY}', searchQuery.queryText);
      
      const response = await this.complete(prompt, this.keywordModel);
      
      try {
        // JSONとして解析
        const keywords = JSON.parse(response);
        
        if (!Array.isArray(keywords)) {
          return ['AI', 'プログラミング', 'データ分析'];
        }
        
        return keywords.slice(0, 3).map(k => String(k));
      } catch (parseError) {
        this.logger.warn('代替キーワードをJSONとして解析できませんでした', { response });
        return ['セミナー', 'オンライン', '勉強会'];
      }
    } catch (error) {
      this.logger.error('代替キーワードの提案に失敗しました', { error });
      return ['セミナー', 'オンライン', '勉強会'];
    }
  }
}

export default GPTClient;
