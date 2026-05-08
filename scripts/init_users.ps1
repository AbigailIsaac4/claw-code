# Production user initialization script (Windows)
# Usage: .\scripts\init_users.ps1 [-ApiUrl "https://api.claw.example.com"]

param(
    [string]$ApiUrl = "http://127.0.0.1:18008"
)

$REGISTER_URL = "${ApiUrl}/v1/auth/register"
$password = "Abc123456!"

Write-Host "=== Claw Agent User Initialization ===" -ForegroundColor Cyan
Write-Host "API: $REGISTER_URL"
Write-Host ""

# 53 users from 账号信息.xlsx
$users = @(
    @{ email = "Yongzhong.wang@accuredit.com"; full_name = "王永忠" },
    @{ email = "Jialin.tao@accuredit.com";     full_name = "陶佳林" },
    @{ email = "han.qiu@accuredit.com";        full_name = "邱涵" },
    @{ email = "qian.yang@accuredit.com";      full_name = "杨倩" },
    @{ email = "kexu.yan@accuredit.com";       full_name = "颜克旭" },
    @{ email = "ye.chen@accuredit.com";        full_name = "陈业" },
    @{ email = "yuxin.ma@accuredit.com";       full_name = "马雨欣" },
    @{ email = "huanle.liu@accuredit.com";     full_name = "刘欢乐" },
    @{ email = "pengfei.hu@accuredit.com";     full_name = "胡鹏飞" },
    @{ email = "chuanlong.liu@accuredit.com";  full_name = "刘传龙" },
    @{ email = "leqi.liao@accuredit.com";      full_name = "廖乐祺" },
    @{ email = "aihua.feng@accuredit.com";     full_name = "冯爱华" },
    @{ email = "wenqian.feng@accuredit.com";   full_name = "冯文倩" },
    @{ email = "lulu.ji@accuredit.com";        full_name = "纪璐璐" },
    @{ email = "yajie.zhai@accuredit.com";     full_name = "翟雅洁" },
    @{ email = "yao.shao@accuredit.com";       full_name = "邵瑶" },
    @{ email = "songyuan.li@accuredit.com";    full_name = "李松沅" },
    @{ email = "feifei.duan@accuredit.com";    full_name = "段菲菲" },
    @{ email = "ke.qin@accuredit.com";         full_name = "秦珂" },
    @{ email = "dongxue.shen@accuredit.com";   full_name = "沈冬雪" },
    @{ email = "liuhai.wu@accuredit.com";      full_name = "吴刘海" },
    @{ email = "yuanyuan.liu@accuredit.com";   full_name = "刘媛媛" },
    @{ email = "yuping.liu@accuredit.com";     full_name = "刘羽平" },
    @{ email = "shengyu.wang@accuredit.com";   full_name = "王晟宇" },
    @{ email = "dandan.zhu@accuredit.com";     full_name = "朱丹丹" },
    @{ email = "zhenlong.xu@accuredit.com";    full_name = "许振龙" },
    @{ email = "bo.xu@accuredit.com";          full_name = "胥波" },
    @{ email = "xuehua.cai@accuredit.com";     full_name = "蔡学花" },
    @{ email = "na.liang@accuredit.com";       full_name = "梁娜" },
    @{ email = "hao.wu@accuredit.com";         full_name = "吴昊" },
    @{ email = "dong.xia@accuredit.com";       full_name = "夏董" },
    @{ email = "liang.zhao@accuredit.com";     full_name = "赵亮" },
    @{ email = "xiujuan.zhu@accuredit.com";    full_name = "朱秀娟" },
    @{ email = "changren.liu@accuredit.com";   full_name = "刘长仁" },
    @{ email = "liangcheng.li@accuredit.com";  full_name = "李良成" },
    @{ email = "zhigang.gao@accuredit.com";    full_name = "高芝岗" },
    @{ email = "mingke.wu@accuredit.com";      full_name = "吴明科" },
    @{ email = "yanwen.wang@accuredit.com";    full_name = "汪艳文" },
    @{ email = "zhouyang.wang@accuredit.com";  full_name = "王洲阳" },
    @{ email = "zhiqiang.zhou@accuredit.com";  full_name = "周志强" },
    @{ email = "suna.yang@accuredit.com";      full_name = "杨素娜" },
    @{ email = "sijin.he@accuredit.com";       full_name = "贺思锦" },
    @{ email = "li.feng@accuredit.com";        full_name = "冯立" },
    @{ email = "qian.deng@accuredit.com";      full_name = "邓千" },
    @{ email = "zhaoguo.chen@accuredit.com";   full_name = "陈兆国" },
    @{ email = "dawei.cui@accuredit.com";      full_name = "崔大伟" },
    @{ email = "tingting.zhang@accuredit.com"; full_name = "张婷婷" },
    @{ email = "yeting.wu@accuredit.com";      full_name = "吴叶婷" },
    @{ email = "zhuoqun.zhang@accuredit.com";  full_name = "张卓群" },
    @{ email = "guozheng.li@accuredit.com";    full_name = "李国政" },
    @{ email = "zheng.zheng@accuredit.com";    full_name = "郑铮" },
    @{ email = "ben.gu@accuredit.com";         full_name = "顾犇" },
    @{ email = "xinjie.liu@accuredit.com";     full_name = "刘欣杰" }
)

$success = 0; $skipped = 0; $failed = 0

foreach ($u in $users) {
    $body = @{ email = $u.email; password = $password; full_name = $u.full_name } | ConvertTo-Json -Depth 3
    try {
        Invoke-WebRequest -Uri $REGISTER_URL -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
        Write-Host "  OK   $($u.email) ($($u.full_name))" -ForegroundColor Green
        $success++
    } catch {
        $code = $_.Exception.Response.StatusCode.Value__
        if ($code -eq 400) {
            Write-Host "  SKIP $($u.email) (already exists)" -ForegroundColor Yellow
            $skipped++
        } else {
            Write-Host "  FAIL $($u.email) [$code]" -ForegroundColor Red
            $failed++
        }
    }
}

Write-Host ""
Write-Host "=== Done: $success created, $skipped skipped, $failed failed ===" -ForegroundColor Cyan
