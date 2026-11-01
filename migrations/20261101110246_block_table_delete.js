export const up = (knex) => knex.raw(`
    create function block_delete() returns trigger language plpgsql as $$
    begin
      raise exception 'deleting from % is blocked - disable the trigger first if you really mean it', tg_table_name;
    end $$;
    create trigger reels_block_delete before delete or truncate on reels for each statement execute function block_delete();
    create trigger stories_block_delete before delete or truncate on stories for each statement execute function block_delete();
  `);
  
  export const down = (knex) => knex.raw(`
    drop trigger reels_block_delete on reels;
    drop trigger stories_block_delete on stories;
    drop function block_delete();
  `);