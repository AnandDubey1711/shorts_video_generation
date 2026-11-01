export const up = async (knex) => {
  // pool of fetched posts that passed the checks; a fetch job picks a cohort of unpicked ones and turns them into reels
  await knex.schema.createTable('stories', (t) => {
    t.increments('id');
    t.string('source').notNullable();
    t.string('source_id').notNullable();
    t.string('subreddit').notNullable();
    t.text('source_url');
    t.text('original_title').notNullable();
    t.text('original_text').notNullable();
    t.integer('score');
    t.bigInteger('created_utc').notNullable();
    t.timestamp('fetched_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('picked_at');
    t.unique(['source', 'source_id']);
  });
  // where each subreddit's last fetched page ended, so the next refill continues further back in time
  await knex.schema.createTable('fetch_cursors', (t) => {
    t.string('subreddit').primary();
    t.bigInteger('before_utc').notNullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

export const down = async (knex) => {
  await knex.schema.dropTable('fetch_cursors');
  await knex.schema.dropTable('stories');
};
