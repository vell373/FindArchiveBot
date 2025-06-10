import { CommandInteraction, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import CacheService from '../services/CacheService';
import NotionClient from '../components/NotionClient';
import Logger from '../utils/Logger';

export default class AdminCommand {
  private cacheService: CacheService;
  private notionClient: NotionClient;
  private logger: Logger;
  
  // キャッシュキー
  private readonly CATEGORIES_CACHE_KEY = 'seminar:categories';
  private readonly TOOLS_CACHE_KEY = 'seminar:tools';
  
  constructor(notionClient: NotionClient, cacheService: CacheService) {
    this.notionClient = notionClient;
    this.cacheService = cacheService;
    this.logger = new Logger('AdminCommand');
  }
  
  /**
   * スラッシュコマンド定義を取得
   * @returns スラッシュコマンド定義
   */
  getCommandDefinition() {
    return new SlashCommandBuilder()
      .setName('admin')
      .setDescription('管理者用コマンド')
      .addSubcommand(subcommand =>
        subcommand
          .setName('refresh-cache')
          .setDescription('カテゴリとツールのキャッシュを更新します')
      );
  }
  
  /**
   * コマンド実行処理
   */
  async execute(interaction: CommandInteraction): Promise<void> {
    // ChatInputCommandInteractionにキャスト
    if (!interaction.isChatInputCommand()) return;
    
    const chatInteraction = interaction as ChatInputCommandInteraction;
    
    // 管理者権限チェック
    if (!interaction.memberPermissions?.has('Administrator')) {
      await interaction.reply({
        content: 'このコマンドは管理者のみ実行できます。',
        ephemeral: true
      });
      return;
    }
    
    const subcommand = chatInteraction.options.getSubcommand();
    
    if (subcommand === 'refresh-cache') {
      await this.refreshCache(chatInteraction);
    }
  }
  
  /**
   * キャッシュ更新処理
   */
  private async refreshCache(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      // キャッシュを削除
      this.cacheService.delete(this.CATEGORIES_CACHE_KEY);
      this.cacheService.delete(this.TOOLS_CACHE_KEY);
      
      // 再取得
      const categories = await this.notionClient.getCategories();
      const tools = await this.notionClient.getTools();
      
      // 新しいデータをキャッシュ
      this.cacheService.set(this.CATEGORIES_CACHE_KEY, categories);
      this.cacheService.set(this.TOOLS_CACHE_KEY, tools);
      
      await interaction.editReply({
        content: `✅ カテゴリ（${categories.length}件）とツール（${tools.length}件）の選択肢を更新しました。`
      });
      
      this.logger.info('管理者コマンドによりキャッシュを更新しました', {
        userId: interaction.user.id,
        categoriesCount: categories.length,
        toolsCount: tools.length
      });
    } catch (error) {
      this.logger.error('キャッシュ更新に失敗しました', error);
      await interaction.editReply({
        content: '❌ キャッシュの更新に失敗しました。詳細はログを確認してください。'
      });
    }
  }
}
