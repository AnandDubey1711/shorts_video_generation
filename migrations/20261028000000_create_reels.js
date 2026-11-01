export const up = (knex) =>
  knex.schema.createTable('reels', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('source').notNullable();
    t.string('source_id').notNullable();
    t.text('source_url');
    t.text('original_title');
    t.text('original_text');
    t.text('title');
    t.text('story');
    t.text('description');
    t.specificType('hashtags', 'text[]');
    t.string('narrator_gender');
    t.string('voice');
    t.text('audio_path');
    t.text('subs_path');
    t.text('bg_video_path');
    t.text('video_path');
    t.string('youtube_id');
    t.string('status').notNullable().defaultTo('pending');  
    t.string('failed_step');
    t.text('error');
    t.timestamps(true, true);
    t.unique(['source', 'source_id']);
  });

export const down = (knex) => knex.schema.dropTable('reels');
