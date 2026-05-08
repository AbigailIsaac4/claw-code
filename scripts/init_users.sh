#!/usr/bin/env bash
# Production user initialization script
# Usage: ./scripts/init_users.sh [API_BASE_URL]
# Example: ./scripts/init_users.sh https://api.claw.example.com

set -euo pipefail

API_BASE="${1:-http://127.0.0.1:18008}"
REGISTER_URL="${API_BASE}/v1/auth/register"

echo "=== Claw Agent User Initialization ==="
echo "API: ${REGISTER_URL}"
echo ""

success=0
skipped=0
failed=0

register() {
    local email="$1" full_name="$2" password="Abc123456!"

    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$REGISTER_URL" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"full_name\":\"${full_name}\"}")

    case "$http_code" in
        200) echo "  OK   ${email} (${full_name})"; success=$((success + 1)) ;;
        400) echo "  SKIP ${email} (already exists)"; skipped=$((skipped + 1)) ;;
        *)   echo "  FAIL ${email} [HTTP ${http_code}]"; failed=$((failed + 1)) ;;
    esac
}

# 53 users from 账号信息.xlsx
register "Yongzhong.wang@accuredit.com" "王永忠"
register "Jialin.tao@accuredit.com" "陶佳林"
register "han.qiu@accuredit.com" "邱涵"
register "qian.yang@accuredit.com" "杨倩"
register "kexu.yan@accuredit.com" "颜克旭"
register "ye.chen@accuredit.com" "陈业"
register "yuxin.ma@accuredit.com" "马雨欣"
register "huanle.liu@accuredit.com" "刘欢乐"
register "pengfei.hu@accuredit.com" "胡鹏飞"
register "chuanlong.liu@accuredit.com" "刘传龙"
register "leqi.liao@accuredit.com" "廖乐祺"
register "aihua.feng@accuredit.com" "冯爱华"
register "wenqian.feng@accuredit.com" "冯文倩"
register "lulu.ji@accuredit.com" "纪璐璐"
register "yajie.zhai@accuredit.com" "翟雅洁"
register "yao.shao@accuredit.com" "邵瑶"
register "songyuan.li@accuredit.com" "李松沅"
register "feifei.duan@accuredit.com" "段菲菲"
register "ke.qin@accuredit.com" "秦珂"
register "dongxue.shen@accuredit.com" "沈冬雪"
register "liuhai.wu@accuredit.com" "吴刘海"
register "yuanyuan.liu@accuredit.com" "刘媛媛"
register "yuping.liu@accuredit.com" "刘羽平"
register "shengyu.wang@accuredit.com" "王晟宇"
register "dandan.zhu@accuredit.com" "朱丹丹"
register "zhenlong.xu@accuredit.com" "许振龙"
register "bo.xu@accuredit.com" "胥波"
register "xuehua.cai@accuredit.com" "蔡学花"
register "na.liang@accuredit.com" "梁娜"
register "hao.wu@accuredit.com" "吴昊"
register "dong.xia@accuredit.com" "夏董"
register "liang.zhao@accuredit.com" "赵亮"
register "xiujuan.zhu@accuredit.com" "朱秀娟"
register "changren.liu@accuredit.com" "刘长仁"
register "liangcheng.li@accuredit.com" "李良成"
register "zhigang.gao@accuredit.com" "高芝岗"
register "mingke.wu@accuredit.com" "吴明科"
register "yanwen.wang@accuredit.com" "汪艳文"
register "zhouyang.wang@accuredit.com" "王洲阳"
register "zhiqiang.zhou@accuredit.com" "周志强"
register "suna.yang@accuredit.com" "杨素娜"
register "sijin.he@accuredit.com" "贺思锦"
register "li.feng@accuredit.com" "冯立"
register "qian.deng@accuredit.com" "邓千"
register "zhaoguo.chen@accuredit.com" "陈兆国"
register "dawei.cui@accuredit.com" "崔大伟"
register "tingting.zhang@accuredit.com" "张婷婷"
register "yeting.wu@accuredit.com" "吴叶婷"
register "zhuoqun.zhang@accuredit.com" "张卓群"
register "guozheng.li@accuredit.com" "李国政"
register "zheng.zheng@accuredit.com" "郑铮"
register "ben.gu@accuredit.com" "顾犇"
register "xinjie.liu@accuredit.com" "刘欣杰"

echo ""
echo "=== Done: ${success} created, ${skipped} skipped, ${failed} failed ==="
