// ============================================================
// supabase-config.js — 联机对战的 Supabase Realtime 接入配置
// ============================================================
// 这里放的是 **publishable（可发布 / 匿名）key**，设计上就是给客户端用的、公开安全：
//   - 受 Supabase 行级安全（RLS）保护，拿到它也读不到没授权的数据；
//   - 本项目只用它开 Realtime 广播频道 + presence（联机房间/状态同步），不读写任何数据库表。
// 切勿在此放 secret key / service_role key / 数据库密码 / 连接串——那些是服务端机密。
//
// net.js 在需要跨设备联机时读取 window.PR_SUPABASE；未设置则自动退回「本机多标签」测试模式。
window.PR_SUPABASE = {
  url: "https://jykfmsfpcewerzdqadec.supabase.co",
  key: "sb_publishable_64Xp4XcqS35sG4CZ8EYqiA_bnwd-QCf",
};
