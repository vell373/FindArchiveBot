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
    console.log(`[DEBUG] SeminarCommand.execute called. User: ${interaction.user.id}`);
    try {
      this.logger.info('セミナーコマンドが実行されました', {
        userId: interaction.user.id,
        channelId: interaction.channelId
      });

      // モーダルを構築して表示 (キーワード入力専用)
      // カテゴリとツールはモーダル送信後に取得する
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
    console.log(`[DEBUG] SeminarCommand.handleModalSubmit called. User: ${interaction.user.id}, CustomID: ${interaction.customId}`);
    try {
      // インタラクションタイプはすでにModalSubmitInteractionとして渡されているので
      // 追加のチェックは不要です

      // モーダル送信は一時的なものなので、deferReply() を使って応答時間を延長
      // 全ユーザーに表示するためにephemeralをfalseに設定
      await interaction.deferReply({ ephemeral: false })
        .catch(err => {
          this.logger.error('インタラクション応答延長エラー', { error: err });
          // エラーを無視して続行（すでに応答済みの可能性）
        });

      this.logger.info('セミナー検索モーダルが送信されました（キーワード入力段階）', {
        userId: interaction.user.id,
        channelId: interaction.channelId,
        customId: interaction.customId
      });

      // モーダル入力から検索キーワードを抽出
      const { queryText } = this.modalBuilder.extractSearchQueryFromModal(interaction);

      if (!queryText || queryText.trim().length === 0) {
        await interaction.editReply({ content: '検索キーワードが入力されていません。' })
          .catch(err => {
            this.logger.error('空のキーワードエラー応答中にエラーが発生しました', { error: err });
          });
        return;
      }

      this.logger.info('キーワードを受け付けました', { queryText });

      // コンポーネントを含むメッセージを送信し、そのメッセージIDを取得
      let messageId = '';
      let replyMessage;
      try {
        replyMessage = await interaction.editReply({
          content: `キーワード「${queryText}」について、カテゴリとツールを選択してください。`,
          components: [], // 一旦空で送信します
        });
        messageId = replyMessage.id;
      } catch (err) {
        this.logger.error('初期メッセージ更新中に重大なエラーが発生しました (messageId取得箇所)', { 
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : JSON.stringify(err),
          userId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          customId: interaction.customId, // modal customId
          queryText: queryText,
          attemptedContent: `キーワード「${queryText}」について、カテゴリとツールを選択してください。`
        });
        // エラーが発生した場合は処理を終了します。この時点でユーザーには Discord の標準エラーか、
        // deferReply が成功していればその応答が見えているはずです。
        // ここで followUp すると新しいメッセージになるため、ログ出力に留めます。
        return;
      }

      // 初期状態をキャッシュに保存
      const initialState = { queryText, selectedCategories: [], selectedTools: [] };
      this.cacheService.set(`seminar_state:${interaction.user.id}:${messageId}`, initialState, this.INTERACTION_STATE_CACHE_TTL);
      this.logger.info('初期インタラクション状態をキャッシュに保存しました', { userId: interaction.user.id, messageId, queryText });

      // カテゴリとツールのリストを取得
      const categories = await this.getCategories();
      const tools = await this.getTools();

      // 全てのコンポーネント行を格納する配列
      const componentRows: ActionRowBuilder<any>[] = [];
      
      // Discord.jsの制限
      const MAX_OPTIONS_PER_MENU = 25; // 1つのメニューに最大25個のオプション
      const MAX_COMPONENT_ROWS = 4; // 最大5行（ボタン用に1行確保するので4行）
      
      // カテゴリを複数の選択メニューに分割
      let categoryRowCount = 0;
      // DEBUG: カテゴリメニューを1つに制限
    for (let i = 0; i < Math.ceil(categories.length / MAX_OPTIONS_PER_MENU) && categoryRowCount < MAX_COMPONENT_ROWS; i++) {
        const categoryChunk = categories.slice(i * MAX_OPTIONS_PER_MENU, (i + 1) * MAX_OPTIONS_PER_MENU);
        if (categoryChunk.length === 0) continue;
        
        const categorySelect = new StringSelectMenuBuilder()
          .setCustomId(`seminar_category_select_${i}:${messageId}`)
          .setPlaceholder(`カテゴリ ${i+1}（${categoryChunk.length}件）`)
          .setMinValues(0)
          .setMaxValues(categoryChunk.length);
        
        categorySelect.addOptions(
          categoryChunk.map(cat => 
            new StringSelectMenuOptionBuilder().setLabel(cat).setValue(cat)
          )
        );
        
        componentRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect));
        categoryRowCount++;
      }
      
      // カテゴリがない場合のダミー行
      if (categoryRowCount === 0) {
        const dummyCategorySelect = new StringSelectMenuBuilder()
          .setCustomId(`seminar_category_select_0:${messageId}`)
          .setPlaceholder('カテゴリなし')
          .setMinValues(0)
          .setMaxValues(1)
          .setDisabled(true)
          .addOptions(new StringSelectMenuOptionBuilder().setLabel('カテゴリなし').setValue('no_category_placeholder'));
        
        componentRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dummyCategorySelect));
        categoryRowCount++;
      }
      
      // ツールを複数の選択メニューに分割
      const remainingRows = MAX_COMPONENT_ROWS - categoryRowCount;
      // DEBUG: ツールメニューを1つに制限 (remainingRows の代わりに 1 を使用)
    for (let i = 0; i < Math.ceil(tools.length / MAX_OPTIONS_PER_MENU) && i < remainingRows; i++) {
        const toolChunk = tools.slice(i * MAX_OPTIONS_PER_MENU, (i + 1) * MAX_OPTIONS_PER_MENU);
        if (toolChunk.length === 0) continue;
        
        const toolSelect = new StringSelectMenuBuilder()
          .setCustomId(`seminar_tool_select_${i}:${messageId}`)
          .setPlaceholder(`ツール ${i+1}（${toolChunk.length}件）`)
          .setMinValues(0)
          .setMaxValues(toolChunk.length);
        
        toolSelect.addOptions(
          toolChunk.map(tool => 
            new StringSelectMenuOptionBuilder().setLabel(tool).setValue(tool)
          )
        );
        
        componentRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toolSelect));
      }
      
      // ツールがない場合のダミー行
      let toolCount = componentRows.length - categoryRowCount;
      if (toolCount === 0 && remainingRows > 0) {
        const dummyToolSelect = new StringSelectMenuBuilder()
          .setCustomId(`seminar_tool_select_0:${messageId}`)
          .setPlaceholder('ツールなし')
          .setMinValues(0)
          .setMaxValues(1)
          .setDisabled(true)
          .addOptions(new StringSelectMenuOptionBuilder().setLabel('ツールなし').setValue('no_tool_placeholder'));
        
        componentRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dummyToolSelect));
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

      // ボタン行を追加
      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(searchButton, cancelSearchButton);
      componentRows.push(buttonRow);

      // 最終的なコンポーネントでメッセージを更新
      this.logger.info('作成されたコンポーネント行:', { 
        count: componentRows.length,
        componentsJson: JSON.stringify(componentRows.map(row => row.toJSON()), null, 2) // コンポーネント構造をログに出力
      });

      try {
        await interaction.editReply({
          content: `キーワード「${queryText}」について、カテゴリとツールを選択してください。\n※複数のカテゴリ・ツールを選択できます（各メニューごとに最大25個まで）`,
          components: componentRows
        });
        this.logger.info('カテゴリとツールの選択メニューを送信しました', { userId: interaction.user.id, messageId });
      } catch (error) {
        this.logger.error('選択メニューの送信中に重大なエラーが発生しました', { 
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : JSON.stringify(error),
          userId: interaction.user.id,
          messageId,
          queryText,
          componentCount: componentRows.length,
          // 送信しようとしたコンポーネントのJSON表現もログに出力
          componentsSentJson: JSON.stringify(componentRows.map(row => row.toJSON()), null, 2)
        });
        // このエラーはユーザーに直接影響するため、可能であればフォールバックメッセージを送信
        try {
          // editReplyが失敗した後なので、followUpで通知
          // ただし、followUpも失敗する可能性がある（例：インタラクションが完全に終了している）
          if (interaction.channel) { // channelが存在する場合のみ試行
            await interaction.followUp({ content: '選択肢の表示中に問題が発生しました。お手数ですが、もう一度コマンドを実行してください。', ephemeral: true });
          }
        } catch (followUpError) {
          this.logger.error('選択メニュー送信エラー後のフォールバックメッセージ送信にも失敗しました', { 
            originalError: error instanceof Error ? error.message : JSON.stringify(error),
            followUpError: followUpError instanceof Error ? { name: followUpError.name, message: followUpError.message, stack: followUpError.stack } : JSON.stringify(followUpError)
          });
        }
      }
      
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
