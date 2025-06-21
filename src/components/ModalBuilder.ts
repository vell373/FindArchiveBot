import {
  ActionRowBuilder,
  ModalBuilder as DiscordModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import Logger from '../utils/Logger';

/**
 * Discordモーダルを構築するクラス
 */
export default class ModalBuilder {
  private logger: Logger;

  /**
   * ModalBuilderのコンストラクタ
   */
  constructor() {
    this.logger = new Logger('ModalBuilder');
  }

  /**
   * セミナー検索用のモーダルを構築
   * @returns 構築されたモーダル
   */
  buildSeminarSearchModal() { // categories と tools を引数から削除
    this.logger.info('セミナー検索モーダル（キーワード入力専用）を構築します');

    const modal = new DiscordModalBuilder()
      .setCustomId('seminar-search-modal')
      .setTitle('セミナー検索');

    const queryInput = new TextInputBuilder()
      .setCustomId('queryText')
      .setLabel('検索したいキーワードを入力してください')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('例：インスタ、リール、AIライティング...')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(200);

    const queryRow = new ActionRowBuilder<TextInputBuilder>().addComponents(queryInput);

    modal.addComponents(queryRow);

    this.logger.info('セミナー検索モーダル（キーワード入力専用）を構築しました');
    return modal;
  }

  /**
   * モーダル入力から検索クエリを生成
   * @param interaction モーダル送信インタラクション
   * @returns 検索クエリオブジェクト
   */
  extractSearchQueryFromModal(interaction: any): { queryText: string } {
    const queryText = interaction.fields.getTextInputValue('queryText');

    this.logger.info('モーダル入力から検索キーワードを抽出しました', {
      queryText
    });

    return {
      queryText
    };
  }
}
