import { 
  CommandInteraction, 
  SlashCommandBuilder,
  ModalSubmitInteraction,
  InteractionResponse,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType
} from 'discord.js';
import NotionClient from '../components/NotionClient';
import GPTClient from '../components/GPTClient';
import ModalBuilder from '../components/ModalBuilder';
import EmbedBuilder from '../components/EmbedBuilder';
import { Formatter } from '../components/Formatter';
import CacheService from '../services/CacheService';
import Logger from '../utils/Logger';
import ErrorHandler, { AppError, ErrorType } from '../utils/ErrorHandler';
import { SearchQuery } from '../models/SearchQuery';
import { SeminarRecord, RankedSeminarRecord } from '../models/SeminarRecord';
import PromptManager from '../utils/PromptManager';

/**
 * セミナー検索コマンドを処理するクラス
 */
export default class SeminarCommand {
  private notionClient: NotionClient;
  private gptClient: GPTClient;
  private modalBuilder: ModalBuilder;
  private embedBuilder: EmbedBuilder;
  private formatter: Formatter;
  private cacheService: CacheService;
  private logger: Logger;
  private errorHandler: ErrorHandler;

  // キャッシュキー
  private readonly CATEGORIES_CACHE_KEY = 'seminar:categories';
  private readonly TOOLS_CACHE_KEY = 'seminar:tools';
  private readonly CACHE_TTL = 3600000; // 1時間
  private readonly INTERACTION_STATE_CACHE_TTL = 900000; // 15分

  /**
   * SeminarCommandのコンストラクタ
   * @param notionClient NotionClientインスタンス
   * @param gptClient GPTClientインスタンス
   * @param cacheService CacheServiceインスタンス
   */
  constructor(
    notionClient: NotionClient,
    gptClient: GPTClient,
    cacheService: CacheService
  ) {
    this.notionClient = notionClient;
    this.gptClient = gptClient;
    this.cacheService = cacheService;
    this.modalBuilder = new ModalBuilder();
    this.embedBuilder = new EmbedBuilder();
    this.formatter = new Formatter();
    this.logger = new Logger('SeminarCommand');
    this.errorHandler = new ErrorHandler('SeminarCommand');
  }

  /**
   * スラッシュコマンド定義を取得
   * @returns スラッシュコマンド定義
   */
  getCommandDefinition() {
    return new SlashCommandBuilder()
      .setName('seminar')
      .setDescription('セミナーアーカイブを検索します');
  }

  /**
   * コマンド実行時の処理
   * @param interaction コマンドインタラクション
   */
  async execute(interaction: CommandInteraction): Promise<void> {
    try {
      this.logger.info('セミナーコマンドが実行されました', {
        userId: interaction.user.id,
        channelId: interaction.channelId
      });

      // カテゴリとツールのリストを取得（キャッシュから、なければAPIから）
      const categories = await this.getCategories();
      const tools = await this.getTools();

      // モーダルを構築して表示 (キーワード入力専用)
      const modal = this.modalBuilder.buildSeminarSearchModal();
      await interaction.showModal(modal);

    } catch (error) {
      const appError = this.errorHandler.handle(error);
      const errorMessage = this.errorHandler.getUserFriendlyMessage(appError);
      
      // エラーメッセージを表示（エフェメラル）
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ 
          content: errorMessage, 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: errorMessage, 
          ephemeral: true 
        });
      }
    }
  }

  /**
   * モーダル送信時の処理
   * @param interaction モーダル送信インタラクション
   */
  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      // モーダル送信は一時的なものなので、deferUpdate() を使うか、すぐにeditReplyで内容を更新する
      // 全ユーザーに表示するためにephemeralをfalseに設定
      await interaction.deferReply({ ephemeral: false });

      this.logger.info('セミナー検索モーダルが送信されました（キーワード入力段階）', {
        userId: interaction.user.id,
        channelId: interaction.channelId,
        customId: interaction.customId
      });

      // モーダル入力から検索キーワードを抽出
      const { queryText } = this.modalBuilder.extractSearchQueryFromModal(interaction);

      if (!queryText || queryText.trim().length === 0) {
        await interaction.editReply({ content: '検索キーワードが入力されていません。' });
        return;
      }

      this.logger.info('キーワードを受け付けました', { queryText });

      // コンポーネントを含むメッセージを送信し、そのメッセージIDを取得
      // editReplyはPromise<Message>を返すので、それをawaitする
      const replyMessage = await interaction.editReply({
        content: `キーワード「${queryText}」について、カテゴリとツールを選択してください。`,
        components: [], // 一旦空で送信し、後でIDを使って更新するわけではない。最初からコンポーネントを含める。
      });
      const messageId = replyMessage.id; 

      // 初期状態をキャッシュに保存
      const initialState = { queryText, selectedCategories: [], selectedTools: [] };
      this.cacheService.set(`seminar_state:${interaction.user.id}:${messageId}`, initialState, this.INTERACTION_STATE_CACHE_TTL);
      this.logger.info('初期インタラクション状態をキャッシュに保存しました', { userId: interaction.user.id, messageId, queryText });

      if (!queryText || queryText.trim().length === 0) {
        await interaction.editReply({ content: '検索キーワードが入力されていません。' });
        return;
      }

      this.logger.info('キーワードを受け付けました', { queryText });

      // カテゴリとツールのリストを取得
      const categories = await this.getCategories();
      const tools = await this.getTools();

      // カテゴリ選択メニュー
      const categorySelect = new StringSelectMenuBuilder()
        .setCustomId(`seminar_category_select:${messageId}`)
        .setPlaceholder('カテゴリを選択（複数可）')
        .setMinValues(0)
        .setMaxValues(Math.min(categories.length > 0 ? categories.length : 1, 5));
      if (categories.length > 0) {
        categorySelect.addOptions(
          categories.slice(0, 25).map(cat => 
            new StringSelectMenuOptionBuilder().setLabel(cat).setValue(cat)
          )
        );
      } else {
        categorySelect.addOptions(new StringSelectMenuOptionBuilder().setLabel('カテゴリなし').setValue('no_category_placeholder')).setDisabled(true);
      }

      // ツール選択メニュー
      const toolSelect = new StringSelectMenuBuilder()
        .setCustomId(`seminar_tool_select:${messageId}`)
        .setPlaceholder('ツールを選択（複数可）')
        .setMinValues(0)
        .setMaxValues(Math.min(tools.length > 0 ? tools.length : 1, 5));
      if (tools.length > 0) {
        toolSelect.addOptions(
          tools.slice(0, 25).map(tool => 
            new StringSelectMenuOptionBuilder().setLabel(tool).setValue(tool)
          )
        );
      } else {
        toolSelect.addOptions(new StringSelectMenuOptionBuilder().setLabel('ツールなし').setValue('no_tool_placeholder')).setDisabled(true);
      }

      // 検索実行ボタン
      const searchButton = new ButtonBuilder()
        .setCustomId(`seminar_execute_search:${messageId}`)
        .setLabel('検索実行')
        .setStyle(ButtonStyle.Primary);
      
      const cancelSearchButton = new ButtonBuilder()
        .setCustomId(`seminar_cancel_search:${messageId}`)
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary);

      const categoryRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect);
      const toolRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toolSelect);
      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(searchButton, cancelSearchButton);

      // コンポーネントをメッセージに設定して更新
      await interaction.editReply({
        content: `キーワード「${queryText}」について、カテゴリとツールを選択してください。`,
        components: [categoryRow, toolRow, buttonRow],
      });
      
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      const errorMessage = this.errorHandler.getUserFriendlyMessage(appError);
      
      const errorEmbed = this.embedBuilder.buildErrorEmbed(errorMessage);
      
      // deferReplyしているので、editReplyでエラーメッセージを更新
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: '処理中にエラーが発生しました。',
          embeds: [errorEmbed],
          components: [] // エラー時はコンポーネントをクリア
        });
      } else {
        // 基本的にはdeferReplyしているのでここには来ないはずだが念のため
        await interaction.reply({
          content: '処理中にエラーが発生しました。',
          embeds: [errorEmbed],
          ephemeral: true
        });
      }
    }
  }

  /**
   * カテゴリリストを取得（キャッシュ優先）
   * @returns カテゴリの配列
   */
  private async getCategories(): Promise<string[]> {
    // キャッシュから取得を試みる
    const cachedCategories = this.cacheService.get<string[]>(this.CATEGORIES_CACHE_KEY);
    if (cachedCategories) {
      return cachedCategories;
    }

    // キャッシュになければAPIから取得
    const categories = await this.notionClient.getCategories();
    
    // キャッシュに保存
    this.cacheService.set(this.CATEGORIES_CACHE_KEY, categories, this.CACHE_TTL);
    
    return categories;
  }

  /**
   * ツールリストを取得（キャッシュ優先）
   * @returns ツールの配列
   */
  /**
   * 選択されたキーワード、カテゴリ、ツールに基づいてセミナー検索を実行し、結果をインタラクションに返信する。
   * @param interaction - ボタンインタラクションまたはセレクトメニューインタラクション
   * @param queryText - ユーザーが入力した元の検索キーワード
   * @param selectedCategories - ユーザーが選択したカテゴリ
   * @param selectedTools - ユーザーが選択したツール
   */
  /**
   * メンションによる検索を処理するメソッド
   * @param searchQuery 検索クエリ
   * @param context メッセージコンテキスト
   */
  async handleMentionSearch(
    searchQuery: SearchQuery,
    context: {
      message: any; // 処理中メッセージ
      originalMessage: any; // 元のメッセージ
      updateMessage: (content: string) => Promise<void>; // メッセージ更新用コールバック
    }
  ): Promise<void> {
    try {
      this.logger.info('メンションによる検索を実行します', {
        userId: context.originalMessage.author.id,
        queryText: searchQuery.queryText
      });

      // キーワードを抽出
      const keywords = await this.gptClient.extractKeywords(searchQuery);
      
      if (keywords.length === 0) {
        await context.updateMessage('検索キーワードを抽出できませんでした。もう少し具体的な質問をお願いします。');
        return;
      }

      this.logger.info('キーワードを抽出しました', { keywords });

      // Notionで検索
      const results = await this.notionClient.searchSeminars(keywords, [], []);

      if (results.length === 0) {
        // 代替キーワードを提案
        const alternativeKeywords = await this.gptClient.suggestAlternativeKeywords(searchQuery);
        const alternativesText = alternativeKeywords.map(kw => `・${kw}`).join('\n');
        
        await context.updateMessage(
          `申し訳ありませんが、「${searchQuery.queryText}」に関連するセミナーが見つかりませんでした。\n\n以下のキーワードで試してみてください:\n${alternativesText}`
        );
        return;
      }

      // 検索結果をランク付け
      const rankedResults = await this.gptClient.rankSearchResults(searchQuery, results);
      
      // 環境変数から表示件数を取得するか、デフォルト値を使用
      const maxResultCount = parseInt(process.env.MAX_RESULT_COUNT || '5', 10);
      const topResults = rankedResults.slice(0, maxResultCount);
      
      // 結果を整形して返信
      const formattedResponse = this.formatter.formatSearchResults(searchQuery.queryText, topResults);
      
      await context.updateMessage(formattedResponse);
      
      this.logger.info('メンション検索の回答を送信しました', {
        resultCount: topResults.length
      });
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      this.logger.error(`メンション検索処理エラー: ${appError.message}`, appError.originalError);
      
      try {
        const errorMessage = this.errorHandler.getUserFriendlyMessage(appError);
        await context.updateMessage(`検索中にエラーが発生しました: ${errorMessage}`);
      } catch (replyError) {
        this.logger.error('エラーメッセージの送信に失敗しました', replyError instanceof Error ? replyError : new Error(String(replyError)));
      }
    }
  }

  async executeSearchWithSelections(
    interaction: ModalSubmitInteraction | CommandInteraction | any, // ButtonInteraction や StringSelectMenuInteraction を含むように調整
    queryText: string,
    selectedCategories: string[],
    selectedTools: string[]
  ): Promise<void> {
    try {
      // deferReplyが既に行われていることを想定し、editReplyで応答を編集する
      // もしdeferReplyされていない場合は、呼び出し側で適切に処理する必要がある
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: false });
      }
      
      // 検索中メッセージは呼び出し側で表示済みのため、ここでは表示しない

      this.logger.info('選択された条件でセミナー検索を実行します', {
        userId: interaction.user.id,
        queryText,
        selectedCategories,
        selectedTools
      });

      // キーワード抽出 (元のqueryText全体をGPTに渡してキーワードを再抽出させるか、
      // queryTextをそのままキーワードとして使うかは設計次第。ここではqueryTextをそのまま使う)
      // const keywords = await this.gptClient.extractKeywords({ queryText, categories: selectedCategories, tools: selectedTools });
      // 上記はSearchQuery型を期待するため、直接queryTextを使うか、SearchQuery型に合わせる
      const keywords = await this.gptClient.extractKeywords({ queryText, categories: selectedCategories, tools: selectedTools } as SearchQuery);

      if (keywords.length === 0) {
        try {
          await interaction.editReply({
            content: '検索キーワードを抽出できませんでした。もう少し具体的な検索クエリを入力してください。',
            components: []
          });
        } catch (interactionError) {
          this.logger.error('キーワード抽出失敗メッセージの表示に失敗しました', interactionError instanceof Error ? interactionError : new Error(String(interactionError)));
        }
        return;
      }
      this.logger.info('検索用キーワードを抽出しました', { keywords });

      // Notionで検索
      const searchResults = await this.notionClient.searchSeminars(
        keywords,
        selectedCategories,
        selectedTools
      );

      if (searchResults.length === 0) {
        const alternativeKeywords = await this.gptClient.suggestAlternativeKeywords({ queryText, categories: selectedCategories, tools: selectedTools } as SearchQuery);
        const noResultsEmbed = this.embedBuilder.buildNoResultsEmbed(queryText, alternativeKeywords);
        try {
          await interaction.editReply({ embeds: [noResultsEmbed], components: [] });
        } catch (interactionError) {
          this.logger.error('検索結果なしメッセージの表示に失敗しました', interactionError instanceof Error ? interactionError : new Error(String(interactionError)));
        }
        return;
      }

      const rankedResults = await this.gptClient.rankSearchResults({ queryText, categories: selectedCategories, tools: selectedTools } as SearchQuery, searchResults);
      
      // 環境変数から表示件数を取得するか、デフォルト値を使用
      const maxResultCount = parseInt(process.env.MAX_RESULT_COUNT || '5', 10);
      const topResults = rankedResults.slice(0, maxResultCount);
      
      // Formatterを使用して検索結果をテキスト形式に整形
      const formattedAnswer = this.formatter.formatSearchResults(queryText, topResults);
      
      // 検索結果をテキスト形式で表示
      try {
        await interaction.editReply({
          content: formattedAnswer,
          components: []
        });
      } catch (interactionError) {
        // Unknown interactionエラーなどの場合はログのみ出力
        this.logger.error('検索結果の表示に失敗しました', interactionError instanceof Error ? interactionError : new Error(String(interactionError)));
      }

      this.logger.info('フィルタ適用済みの検索結果を表示しました', {
        query: queryText,
        resultCount: topResults.length
      });

    } catch (error) {
      const appError = this.errorHandler.handle(error);
      const errorMessage = this.errorHandler.getUserFriendlyMessage(appError);
      const errorEmbed = this.embedBuilder.buildErrorEmbed(errorMessage);
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: '検索処理中にエラーが発生しました。',
          embeds: [errorEmbed],
          components: []
        });
      } else {
         // 万が一 defer も reply もされていない場合 (通常は発生しないはず)
        await interaction.reply({
          content: '検索処理中にエラーが発生しました。',
          embeds: [errorEmbed],
          ephemeral: true,
          components: []
        });
      }
    }
  }

  private async getTools(): Promise<string[]> {
    // キャッシュから取得を試みる
    const cachedTools = this.cacheService.get<string[]>(this.TOOLS_CACHE_KEY);
    if (cachedTools) {
      return cachedTools;
    }

    // キャッシュになければAPIから取得
    const tools = await this.notionClient.getTools();
    
    // キャッシュに保存
    this.cacheService.set(this.TOOLS_CACHE_KEY, tools, this.CACHE_TTL);
    
    return tools;
  }
  

}
