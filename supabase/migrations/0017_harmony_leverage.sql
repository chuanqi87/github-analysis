-- “端侧相关”不等于“对鸿蒙生态有增量贡献”。单独保存鸿蒙杠杆值，
-- 用于压低无需平台工作即可直接使用的通用库，抬高 ArkUI / Node-API /
-- 平台后端 / 多设备协同等能形成鸿蒙专属交付物的项目。
alter table analysis add column if not exists harmony_leverage real;

comment on column analysis.harmony_leverage is
  '0-1 鸿蒙增量杠杆：项目能力经鸿蒙专属集成后可产生多少新增生态价值，而非通用流行度或移植容易度';
