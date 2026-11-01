export const up = async (knex) => {
    await knex.schema.alterTable('reels', (t) => t.dropColumn('source_url'));
    await knex.schema.alterTable('stories', (t) => t.dropColumn('source_url'));
};

export const down = async (knex) => {
    await knex.schema.alterTable('reels', (t) => t.text('source_url'));
    await knex.schema.alterTable('stories', (t) => t.text('source_url'));
};