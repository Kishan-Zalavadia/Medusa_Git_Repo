import { Migration } from '@mikro-orm/migrations';

export class Migration20250318041058 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product" add column if not exists "brand" text;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product" drop column if exists "brand";`);
  }

}
