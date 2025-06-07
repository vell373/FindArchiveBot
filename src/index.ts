import dotenv from 'dotenv';
import { 
  Client, 
  Events, 
  GatewayIntentBits, 
  Message, 
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  ButtonStyle
} from 'discord.js';
import MessageParser from './components/MessageParser';
import PromptManager, { PromptType } from './components/PromptManager';
import GPTClient from './components/GPTClient';
import NotionClient from './components/NotionClient';
import Formatter from './components/Formatter';
import ModalBuilder from './components/ModalBuilder';
import EmbedBuilder from './components/EmbedBuilder';
import Logger from './utils/Logger';
import ErrorHandler, { AppError, ErrorType } from './utils/ErrorHandler';
import CacheService from './services/CacheService';
import SeminarCommand from './commands/SeminarCommand';
import { SearchQuery } from './models/SearchQuery';
import { SeminarRecord, RankedSeminarRecord } from './models/SeminarRecord';

// Discordのレート制限に関する定数
const RATE_LIMIT_RETRY_DELAY = 5000; // 5秒
const MAX_RETRY_ATTEMPTS = 3;

// 環境変数を読み込む
dotenv.config();

// 必要な環境変数を検証
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_APPLICATION_ID',
  'OPENAI_API_KEY',
  'MCP_API_KEY',
  'MCP_API_BASE_URL',
  'NOTION_DATABASE_ID'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`環境変数が設定されていません: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// メインロガーを初期化
const logger = new Logger('Main');
const errorHandler = new ErrorHandler('Main');

// Botクラス
class NotionMCPDiscordBot {
  private client: Client;
  private messageParser: MessageParser;
  private promptManager: PromptManager;
  private gptClient: GPTClient;
  private notionClient: NotionClient;
  private formatter: Formatter;
  private cacheService: CacheService;
  private seminarCommand: SeminarCommand;
  private applicationId: string = '';
  private botId: string = '';

  constructor() {
    logger.info('Notion MCP Discord Botを初期化しています');

    // Discord Clientを初期化
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    // 各コンポーネントを初期化
    this.messageParser = new MessageParser();
    this.promptManager = new PromptManager();
    this.cacheService = new CacheService();
    this.gptClient = new GPTClient(process.env.OPENAI_API_KEY!);
    this.notionClient = new NotionClient(
      process.env.MCP_API_KEY!,
      process.env.NOTION_DATABASE_ID!
    );
    this.formatter = new Formatter();
    
    // コマンドハンドラーを初期化
    this.seminarCommand = new SeminarCommand(
      this.notionClient,
      this.gptClient,
      this.cacheService
    );

    // カテゴリとツールの選択肢を定期的に更新する処理を設定
    this.setupCategoryAndToolsPolling();
  }
  
  /**
   * カテゴリとツールの選択肢を定期的に更新する
   */
  private setupCategoryAndToolsPolling(): void {
    const POLLING_INTERVAL = 600000; // 10分ごと
    
    logger.info('カテゴリとツールの自動更新を設定しました', { interval: `${POLLING_INTERVAL / 60000}分` });
    
    setInterval(async () => {
      try {
        // 現在のキャッシュを取得
        const cachedCategories = this.cacheService.get<string[]>('seminar:categories');
        const cachedTools = this.cacheService.get<string[]>('seminar:tools');
        
        // 最新のデータを取得
        const latestCategories = await this.notionClient.getCategories();
        const latestTools = await this.notionClient.getTools();
        
        // 変更があればキャッシュを更新
        if (!cachedCategories || JSON.stringify(cachedCategories) !== JSON.stringify(latestCategories)) {
          this.cacheService.set('seminar:categories', latestCategories, 3600000);
          logger.info('カテゴリ選択肢を更新しました', { count: latestCategories.length });
        }
        
        if (!cachedTools || JSON.stringify(cachedTools) !== JSON.stringify(latestTools)) {
          this.cacheService.set('seminar:tools', latestTools, 3600000);
          logger.info('ツール選択肢を更新しました', { count: latestTools.length });
        }
      } catch (error) {
        logger.error('選択肢の自動更新に失敗しました', error instanceof Error ? error : new Error(String(error)));
      }
    }, POLLING_INTERVAL);
  }

  /**
   * Botを起動
   */
  async start(): Promise<void> {
    try {
      logger.info('Botを起動しています');

      // イベントハンドラーを設定
      this.setupEventHandlers();

      // スラッシュコマンドを登録
      await this.registerCommands();

      // Discordにログイン
      await this.client.login(process.env.DISCORD_TOKEN);

      logger.info('Botの起動が完了しました');
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`Botの起動に失敗しました: ${appError.message}`, appError.originalError);
      process.exit(1);
    }
  }
  
  /**
   * スラッシュコマンドを登録
   */
  private async registerCommands(): Promise<void> {
    try {
      logger.info('スラッシュコマンドを登録しています');
      
      const commands = [
        this.seminarCommand.getCommandDefinition().toJSON(),
      ];
      
      const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
      
      // グローバルコマンドとして登録
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID!),
        { body: commands }
      );
      
      logger.info('スラッシュコマンドの登録が完了しました');
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`スラッシュコマンドの登録に失敗しました: ${appError.message}`, appError.originalError);
      throw appError;
    }
  }

  /**
   * イベントハンドラーを設定
   */
  private setupEventHandlers(): void {
    // Readyイベントのハンドラー
    this.client.once(Events.ClientReady, (readyClient) => {
      this.botId = readyClient.user.id;
      this.applicationId = readyClient.application.id;
      logger.info(`Botとして認識されました: ${readyClient.user.tag}`);
      this.messageParser.setBotId(this.botId);
    });

    // メッセージ作成イベントのハンドラー
    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessageCreate(message);
    });
    
    // インタラクションイベントのハンドラー
    this.client.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction);
    });

    // エラーハンドリング
    process.on('uncaughtException', (error: Error) => {
      const appError = errorHandler.handle(error);
      logger.error(`未捕捉の例外: ${appError.message}`, appError.originalError);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const appError = errorHandler.handle(reason);
      logger.error(`未処理のPromise拒否: ${appError.message}`, appError.originalError);
    });

    // 終了シグナルのハンドリング
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * メッセージ作成イベントを処理
   * @param message - メッセージデータ
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    try {
      // ボット自身のメッセージは無視
      if (message.author.bot) return;
      
      // @hereや@everyoneへのメンションは無視
      if (message.mentions.everyone) return;
      
      // ボットへのメンションかどうかを確認
      const question = this.messageParser.extractQuestion(message);
      if (!question) return;
      
      logger.info('メンションによる質問を受信しました', {
        userId: message.author.id,
        channelId: message.channelId,
        question
      });
      
      // 処理中メッセージを送信
      const processingMessage = await this.safeReply(message, '🔍 質問を処理しています...');
      if (!processingMessage) {
        logger.error('処理中メッセージの送信に失敗しました');
        return;
      }
      
      // 検索クエリを構築
      const searchQuery: SearchQuery = {
        queryText: question,
        categories: [],
        tools: []
      };
      
      // SeminarCommandを使用して検索を実行
      await this.seminarCommand.handleMentionSearch(searchQuery, {
        message: processingMessage,
        originalMessage: message,
        updateMessage: async (content: string) => {
          await this.safeMessageEdit(processingMessage, content);
        }
      });
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`メッセージ処理エラー: ${appError.message}`, appError.originalError);
      
      try {
        // レート制限エラーの場合は少し待機してから再試行
        if (appError.type === ErrorType.DISCORD_RATE_LIMIT) {
          logger.info('Discordレート制限を検出、待機してから再試行します');
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒待機
        }
        
        const errorMessage = errorHandler.getUserFriendlyMessage(appError);
        await this.safeReply(message, errorMessage);
      } catch (replyError) {
        logger.error('エラーメッセージの送信に失敗しました', replyError instanceof Error ? replyError : new Error(String(replyError)));
      }
    }
  }
  
  /**
   * インタラクションイベントを処理
   * @param interaction - インタラクションデータ
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      // スラッシュコマンド
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'seminar') {
          await this.seminarCommand.execute(interaction);
        }
      }
      
      // モーダル送信
      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'seminar-search-modal') {
          await this.seminarCommand.handleModalSubmit(interaction);
        }
      }
      
      // セレクトメニュー選択
      if (interaction.isStringSelectMenu()) {
        const customId = interaction.customId;
        if (customId.startsWith('seminar_category_select:') || customId.startsWith('seminar_tool_select:')) {
          // セレクトメニューの選択を処理
          await this.handleSelectMenuInteraction(interaction);
        }
      }
      
      // ボタン押下
      if (interaction.isButton()) {
        const customId = interaction.customId;
        if (customId.startsWith('seminar_execute_search:') || customId.startsWith('seminar_cancel_search:')) {
          // ボタン押下を処理
          await this.handleButtonInteraction(interaction);
        }
      }
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`インタラクション処理エラー: ${appError.message}`, appError.originalError);
      
      try {
        // エラーメッセージを表示（エフェメラル）
        const errorMessage = errorHandler.getUserFriendlyMessage(appError);
        
        if (interaction.isRepliable()) {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          } else {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
          }
        }
      } catch (replyError) {
        logger.error('エラーメッセージの送信に失敗しました', replyError instanceof Error ? replyError : new Error(String(replyError)));
      }
    }
  }
  
  /**
   * メッセージ作成イベントを処理
   * @param message - メッセージデータ
   */
  /**
   * セレクトメニューインタラクションを処理
   * @param interaction - セレクトメニューインタラクション
   */
  private async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    try {
      // カスタムIDからメッセージIDを抽出
      const parts = interaction.customId.split(':');
      const messageId = parts[1];
      
      // キャッシュから現在の状態を取得
      const cacheKey = `seminar_state:${interaction.user.id}:${messageId}`;
      const state = this.cacheService.get<any>(cacheKey);
      
      if (!state) {
        await interaction.reply({ content: 'セッションがタイムアウトしました。もう一度検索を行ってください。', ephemeral: true });
        return;
      }
      
      // 選択された値を取得
      const selectedValues = interaction.values;
      
      // カテゴリかツールかを判定
      if (interaction.customId.startsWith('seminar_category_select:')) {
        // カテゴリ選択の場合
        state.selectedCategories = selectedValues;
      } else if (interaction.customId.startsWith('seminar_tool_select:')) {
        // ツール選択の場合
        state.selectedTools = selectedValues;
      }
      
      // 更新した状態をキャッシュに保存
      this.cacheService.set(cacheKey, state, 900000); // 15分
      
      // ユーザーに選択が反映されたことを伝える
      await interaction.deferUpdate();
      
      logger.info('セレクトメニュー選択を処理しました', {
        userId: interaction.user.id,
        customId: interaction.customId,
        selectedValues
      });
      
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`セレクトメニュー処理エラー: ${appError.message}`, appError.originalError);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '選択の処理中にエラーが発生しました。', ephemeral: true });
      } else {
        await interaction.followUp({ content: '選択の処理中にエラーが発生しました。', ephemeral: true });
      }
    }
  }

  /**
   * ボタンインタラクションを処理
   * @param interaction - ボタンインタラクション
   */
  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    try {
      // カスタムIDからメッセージIDを抽出
      const parts = interaction.customId.split(':');
      const action = parts[0];
      const messageId = parts[1];
      
      // キャンセルボタンの場合
      if (action === 'seminar_cancel_search') {
        await interaction.update({ content: '検索がキャンセルされました。', components: [] });
        return;
      }
      
      // 検索実行ボタンの場合
      if (action === 'seminar_execute_search') {
        // キャッシュから状態を取得
        const cacheKey = `seminar_state:${interaction.user.id}:${messageId}`;
        const state = this.cacheService.get<any>(cacheKey);
        
        if (!state) {
          await interaction.reply({ content: 'セッションがタイムアウトしました。もう一度検索を行ってください。', ephemeral: true });
          return;
        }
        
        // 検索実行
        await interaction.deferUpdate();
        
        // 検索ボタンを無効化し、検索中メッセージを表示
        try {
          // 検索ボタンを無効化した新しいボタンを作成
          const searchButton = new ButtonBuilder()
            .setCustomId(`seminar_execute_search:${messageId}`)
            .setLabel('検索実行')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true); // 無効化
          
          // キャンセルボタンを作成
          const cancelButton = new ButtonBuilder()
            .setCustomId(`seminar_cancel_search:${messageId}`)
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Secondary);
          
          // ボタンをアクションロウに追加
          const actionRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(searchButton, cancelButton);
          
          // 検索中メッセージと無効化されたボタンを表示
          await interaction.editReply({
            content: 'アーカイブを検索中です...',
            components: [actionRow]
          });
        } catch (error) {
          // ボタン無効化のエラーは検索処理に影響しないようにログのみ出力
          logger.error('検索ボタンの無効化に失敗しました', error instanceof Error ? error : new Error(String(error)));
        }
        
        // 検索実行
        await this.seminarCommand.executeSearchWithSelections(
          interaction,
          state.queryText,
          state.selectedCategories || [],
          state.selectedTools || []
        );
        
        logger.info('検索実行ボタンが押されました', {
          userId: interaction.user.id,
          queryText: state.queryText,
          selectedCategories: state.selectedCategories,
          selectedTools: state.selectedTools
        });
      }
      
    } catch (error) {
      const appError = errorHandler.handle(error);
      logger.error(`ボタン処理エラー: ${appError.message}`, appError.originalError);
      
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'ボタンの処理中にエラーが発生しました。', ephemeral: true });
        } else {
          await interaction.followUp({ content: 'ボタンの処理中にエラーが発生しました。', ephemeral: true });
        }
      } catch (interactionError) {
        // Unknown interactionエラーなどの場合はログのみ出力
        logger.error('エラーメッセージの送信に失敗しました', interactionError instanceof Error ? interactionError : new Error(String(interactionError)));
      }
    }
  }

  // handleMessageCreateメソッドは上部に既に定義されているため、ここの重複した定義を削除

  /**
   * Botをシャットダウン
   */
  private shutdown(): void {
    logger.info('Botをシャットダウンしています');
    
    // Discordから切断
    this.client.destroy();
    
    // 正常終了
    process.exit(0);
  }

  /**
   * レート制限を考慮した安全なメッセージ返信
   * @param message - 元のメッセージ
   * @param content - 返信内容
   * @param attempt - 試行回数（内部使用）
   * @returns 返信されたメッセージまたはnull（失敗時）
   */
  private async safeReply(message: Message, content: string, attempt: number = 1): Promise<Message | null> {
    try {
      return await message.reply(content);
    } catch (error) {
      const appError = errorHandler.handle(error);
      
      // レート制限エラーで、再試行回数が上限に達していない場合
      if (appError.type === ErrorType.DISCORD_RATE_LIMIT && attempt < MAX_RETRY_ATTEMPTS) {
        logger.info(`Discordレート制限を検出、${RATE_LIMIT_RETRY_DELAY/1000}秒待機してから再試行します (試行 ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        
        // 待機してから再試行
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY));
        return this.safeReply(message, content, attempt + 1);
      }
      
      // その他のエラーまたは再試行回数超過
      logger.error(`メッセージ送信エラー: ${appError.message}`, appError.originalError);
      return null;
    }
  }

  /**
   * レート制限を考慮した安全なメッセージ編集
   * @param message - 編集対象のメッセージ
   * @param content - 新しい内容
   * @param attempt - 試行回数（内部使用）
   * @returns 成功したかどうか
   */
  private async safeMessageEdit(message: Message, content: string, attempt: number = 1): Promise<boolean> {
    try {
      await message.edit(content);
      return true;
    } catch (error) {
      const appError = errorHandler.handle(error);
      
      // レート制限エラーで、再試行回数が上限に達していない場合
      if (appError.type === ErrorType.DISCORD_RATE_LIMIT && attempt < MAX_RETRY_ATTEMPTS) {
        logger.info(`Discordレート制限を検出、${RATE_LIMIT_RETRY_DELAY/1000}秒待機してから再試行します (試行 ${attempt}/${MAX_RETRY_ATTEMPTS})`);
        
        // 待機してから再試行
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY));
        return this.safeMessageEdit(message, content, attempt + 1);
      }
      
      // その他のエラーまたは再試行回数超過
      logger.error(`メッセージ編集エラー: ${appError.message}`, appError.originalError);
      return false;
    }
  }
}

// Botのインスタンスを作成して起動
const bot = new NotionMCPDiscordBot();
bot.start().catch(error => {
  logger.error('Botの起動中にエラーが発生しました', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});

// 未処理の例外をキャッチ
process.on('uncaughtException', (error: Error) => {
  logger.error('未捕捉の例外', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('未処理のPromise拒否', reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});
