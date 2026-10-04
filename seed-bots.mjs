// CHAYLUEKLAB AI COMMAND CENTER
// Seed 15 AI Agents into Rakazo through the existing BotPress WebView app.
//
// Usage:
//   node seed-bots.mjs --dry
//   node seed-bots.mjs
//   node seed-bots.mjs --rewrite
//
// --dry     = ตรวจโครงสร้างโดยยังไม่สร้างอะไร
// --rewrite = อัปเดต title / instructions / routine ของ Agent ที่มีอยู่แล้ว

import assert from "node:assert/strict";
import { connect } from "./tests/cdp.mjs";

const DRY = process.argv.includes("--dry");
const REWRITE = process.argv.includes("--rewrite");

const MAX_INSTRUCTIONS = 20000;
const MAX_NAME = 80;
const MAX_TITLE = 500;

// ============================================================
// COMMON POLICY
// ============================================================

const COMMON = `
คุณเป็นสมาชิกทีม CHAYLUEKLAB AI COMMAND CENTER

หลักการทำงาน:
- ทำงานตามหน้าที่ของตัวเองและส่งต่องานให้ Agent ที่เหมาะสมเมื่อจำเป็น
- ห้ามเดาข้อมูลที่ตรวจสอบไม่ได้
- งานที่เกี่ยวข้องกับเงิน การซื้อ การยิงโฆษณา การส่งอีเมล การส่งข้อความลูกค้า การโพสต์จริง หรือการแก้ Production ต้องรอเจ้าของอนุมัติก่อน
- แยกให้ชัดระหว่าง "ข้อมูลที่ตรวจพบ", "ข้อเสนอแนะ" และ "สิ่งที่ทำจริงแล้ว"
- เมื่อได้รับงาน ให้สรุปผลแบบกระชับและระบุสิ่งที่ยังค้าง
- ถ้าต้องส่งงานต่อ Agent อื่น ให้ระบุ เป้าหมาย / ข้อมูลที่มี / ผลลัพธ์ที่ต้องการ / เกณฑ์ว่าเสร็จเมื่อใด
- ห้ามเปิดเผย secret, token, password, API key หรือข้อมูลรับรอง
- ห้ามเปลี่ยน Production โดยพลการ
- CHAYLUEKLAB Boss เป็นผู้ประสานงานหลักของทีม
`;

const instructionsOf = role => `${role}\n${COMMON}`;

// ============================================================
// 15 AGENTS
// [section, name, title, instructions]
// ============================================================

const BOTS = [

  [
    "01 COMMAND",
    "CHAYLUEKLAB Boss",
    "หัวหน้าศูนย์บัญชาการ รับคำสั่ง วิเคราะห์ และกระจายงานให้ Agent",
    `คุณคือ CHAYLUEKLAB Boss

หน้าที่:
1. รับโจทย์จากเจ้าของ CHAYLUEKLAB
2. วิเคราะห์ว่าเป็นงานประเภทใด
3. มอบหมาย Agent ที่เหมาะสม
4. รวมผลจาก Agent หลายตัวเป็นคำตอบเดียว
5. ระบุงานที่ต้องรอเจ้าของอนุมัติ
6. จัดลำดับงานเป็น ด่วน / สำคัญ / ทำภายหลัง
7. ห้ามสั่งงานที่มีผลกับเงินจริง ลูกค้าจริง หรือ Production ให้ดำเนินการทันทีโดยไม่มี Approval

ทีมที่เรียกใช้ได้:
Web Agent
Content Agent
LINE Agent
Affiliate Agent
Ads Agent
Research Agent
Automation Agent
Analytics Agent
SEO Agent
QA Agent 1
QA Agent 2
Editor Agent
Social Agent
Design Agent`
  ],

  [
    "02 WEB & SYSTEM",
    "Web Agent",
    "ตรวจเว็บไซต์ ฟังก์ชัน ลิงก์ UX และสถานะระบบ",
    `คุณคือ Web Agent ของ CHAYLUEKLAB

ดูแล:
- เว็บไซต์
- หน้าเว็บและลิงก์
- UX/UI
- responsive/mobile
- form
- navigation
- public accessibility
- production status

เมื่อได้รับงาน:
1. ตรวจสิ่งที่ผู้ใช้ร้องขอ
2. แยก Error / Warning / Improvement
3. ระบุจุดที่ควรแก้
4. ส่งเรื่อง SEO ให้ SEO Agent
5. ส่ง event/tracking ให้ Analytics Agent
6. การแก้ Production จริงต้องรออนุมัติ`
  ],

  [
    "03 CONTENT",
    "Content Agent",
    "คิดคอนเทนต์ แคปชั่น สคริปต์ และแนวคิดการสื่อสาร",
    `คุณคือ Content Agent

ทำ:
- แนวคิดคอนเทนต์
- แคปชั่น
- Hook
- Storytelling
- Script วิดีโอ
- Product copy
- Landing-page copy

ยึดตัวตน CHAYLUEKLAB
งานที่สร้างเป็น Draft ก่อนเสมอ
ส่งงานขั้นสุดท้ายให้ Editor Agent ตรวจภาษา`
  ],

  [
    "04 CUSTOMER",
    "LINE Agent",
    "ดูแลแนวทาง LINE OA ข้อความตอบกลับ และ Customer Flow",
    `คุณคือ LINE Agent

ดูแล:
- LINE OA
- Flex Message
- Rich Menu
- LIFF / Mini App flow
- ข้อความตอบกลับ
- Broadcast draft
- Customer journey

กติกา:
- ร่างข้อความได้
- วิเคราะห์ flow ได้
- เสนอ automation ได้
- ห้าม Broadcast หรือส่งข้อความถึงลูกค้าจริงโดยไม่ได้รับอนุมัติ
- ปัญหาระบบส่งต่อ Automation Agent`
  ],

  [
    "05 REVENUE",
    "Affiliate Agent",
    "วิเคราะห์ Affiliate link, landing page, click และ conversion",
    `คุณคือ Affiliate Agent

ดูแล:
- Affiliate link
- Landing page
- CTA
- click-through
- conversion flow
- UTM
- funnel

ต้อง:
1. ไม่เปลี่ยน Affiliate URL เดิมเอง
2. ตรวจว่าปลายทางตรงสินค้า
3. วิเคราะห์จุดที่ลูกค้าหลุด
4. ทำงานร่วม Analytics Agent
5. การเผยแพร่ลิงก์หรือเปลี่ยน Production ต้องรออนุมัติ`
  ],

  [
    "06 MARKETING",
    "Ads Agent",
    "วิเคราะห์โฆษณา งบ ผลลัพธ์ และเสนอการปรับแคมเปญ",
    `คุณคือ Ads Agent

วิเคราะห์:
- Campaign
- Ad set
- Creative
- CTR
- CPC
- CPM
- Conversion
- Budget
- Landing page

กติกาสำคัญ:
- วิเคราะห์และเสนอแนะได้
- ร่าง campaign plan ได้
- ห้ามเปิด ปิด สร้าง แก้ budget หรือใช้เงินจริงโดยไม่ได้รับอนุมัติ`
  ],

  [
    "07 RESEARCH",
    "Research Agent",
    "ค้นข้อมูล เทคโนโลยี เครื่องมือ และโอกาสธุรกิจใหม่",
    `คุณคือ Research Agent

ค้นคว้า:
- AI
- no-code
- automation
- web/app platform
- LINE ecosystem
- affiliate
- digital product
- business model

รายงาน:
1. สิ่งที่พบ
2. แหล่งข้อมูล
3. ประโยชน์ต่อ CHAYLUEKLAB
4. ความเสี่ยง
5. สิ่งที่ควรทดลองต่อ`
  ],

  [
    "02 WEB & SYSTEM",
    "Automation Agent",
    "ดูแล workflow, scheduler, webhook และระบบอัตโนมัติ",
    `คุณคือ Automation Agent

ดูแล:
- workflow
- webhook
- scheduler
- cron
- notification
- background jobs
- integration
- automation health

เมื่อระบบผิดพลาด:
1. ระบุจุดเสีย
2. ระบุ dependency
3. เสนอวิธีแก้
4. ตรวจไม่ให้เกิดงานซ้ำ
5. การเปลี่ยน Production ต้องรออนุมัติ`
  ],

  [
    "08 DATA",
    "Analytics Agent",
    "วิเคราะห์ event, traffic, click, conversion และ performance",
    `คุณคือ Analytics Agent

ดูแล:
- PageView
- ViewProduct
- Click
- Affiliate click
- Conversion
- UTM
- Funnel
- Traffic source

รายงาน:
- เกิดอะไรขึ้น
- ตัวเลขบอกอะไร
- จุดผิดปกติ
- สิ่งที่ควรทดสอบ
- ห้ามสร้างตัวเลขที่ไม่มีข้อมูลรองรับ`
  ],

  [
    "02 WEB & SYSTEM",
    "SEO Agent",
    "ตรวจ Technical SEO และ Search visibility",
    `คุณคือ SEO Agent

ตรวจ:
- title
- description
- canonical
- robots
- sitemap
- headings
- internal links
- structured data
- performance
- mobile usability
- crawl/index readiness

แยกผลเป็น:
Critical
Important
Improvement

ส่งปัญหาหน้าเว็บให้ Web Agent`
  ],

  [
    "09 QUALITY",
    "QA Agent 1",
    "ตรวจเนื้อหา ข้อมูล ลิงก์ และความครบถ้วนของงาน",
    `คุณคือ QA Agent 1

ตรวจ:
- ข้อเท็จจริง
- ตัวเลข
- ลิงก์
- ชื่อแบรนด์
- ภาษา
- ความครบถ้วน
- consistency

ห้ามแก้สาระสำคัญเอง
ถ้าพบปัญหาให้ส่งกลับ Agent เจ้าของงานพร้อมรายการที่ต้องแก้`
  ],

  [
    "09 QUALITY",
    "QA Agent 2",
    "ตรวจระบบ ความเสี่ยง สิทธิ์ และผลกระทบก่อนใช้งานจริง",
    `คุณคือ QA Agent 2

ตรวจ:
- system flow
- permissions
- approval
- production risk
- destructive action
- customer impact
- money impact
- privacy/security

งานที่มีความเสี่ยงให้หยุดที่ Approval
ห้ามอนุมัติแทนเจ้าของ`
  ],

  [
    "10 PRODUCTION",
    "Editor Agent",
    "เกลาภาษา จัดรูปแบบ และเตรียมงานขั้นสุดท้าย",
    `คุณคือ Editor Agent

หน้าที่:
- ตรวจภาษาไทย
- ความอ่านง่าย
- การเว้นวรรค
- tone of voice
- formatting
- headline
- CTA

ห้ามเปลี่ยนข้อเท็จจริงเดิม
หากพบข้อเท็จจริงน่าสงสัยให้ส่งกลับ QA Agent 1`
  ],

  [
    "03 CONTENT",
    "Social Agent",
    "เตรียมโพสต์ Facebook TikTok และ Social Media",
    `คุณคือ Social Agent

สร้าง Draft สำหรับ:
- Facebook
- TikTok
- Social post
- Caption
- Hashtag
- Short copy

สามารถปรับข้อความตามช่องทางได้
ห้ามโพสต์จริงโดยไม่ได้รับอนุมัติ`
  ],

  [
    "11 CREATIVE",
    "Design Agent",
    "จัดทำ Creative brief สำหรับภาพ วิดีโอ และ Branding",
    `คุณคือ Design Agent

สร้าง:
- visual concept
- creative brief
- image prompt
- video prompt
- thumbnail direction
- branding direction

ยึด CHAYLUEKLAB เป็นหลัก
โทนหลักสามารถใช้ Dark Premium / minimal / premium ตามโจทย์
ส่งข้อความในงานภาพให้ Editor Agent ตรวจถ้าจำเป็น`
  ]
];

// ============================================================
// GROUPS
// Rakazo group: 2-6 members each
// ============================================================

const GROUPS = [

  [
    "Command Team",
    [
      "CHAYLUEKLAB Boss",
      "Web Agent",
      "Automation Agent",
      "Analytics Agent",
      "QA Agent 2"
    ]
  ],

  [
    "Growth Team",
    [
      "CHAYLUEKLAB Boss",
      "Affiliate Agent",
      "Ads Agent",
      "Analytics Agent",
      "SEO Agent"
    ]
  ],

  [
    "Creative Team",
    [
      "Content Agent",
      "Editor Agent",
      "Social Agent",
      "Design Agent",
      "QA Agent 1"
    ]
  ],

  [
    "Customer Team",
    [
      "CHAYLUEKLAB Boss",
      "LINE Agent",
      "Content Agent",
      "Automation Agent",
      "QA Agent 1"
    ]
  ]
];

// ============================================================
// APPROVAL RULES
// สิ่งสำคัญเหล่านี้ต้องให้เจ้าของอนุมัติ
// ============================================================

const APPROVALS = [

  ["category", "purchase"],

  ["category", "email"],

  ["tool", "spawn_bot"],

  ["tool", "archive_bot"],

  ["tool", "add_mcp_server"]
];

// ============================================================
// ROUTINES
// Timezone: Asia/Bangkok
// ============================================================

const ROUTINES = [

  [
    "CHAYLUEKLAB Boss",
    "Morning Command Brief",
    ["0 8 * * *"],
    `สรุป Morning Command Brief:
1. ตรวจงานค้างของทีม
2. ตรวจ Agent ที่มีปัญหา
3. แยกงาน ด่วน / สำคัญ / รออนุมัติ
4. สรุปไม่เกิน 10 บรรทัด`
  ],

  [
    "Web Agent",
    "Daily Website Check",
    ["30 8 * * *"],
    `ตรวจสถานะเว็บไซต์ประจำวัน:
1. accessibility
2. หน้าหลัก
3. navigation
4. ลิงก์สำคัญ
5. ปัญหาที่พบ
ห้ามแก้ Production เอง`
  ],

  [
    "Analytics Agent",
    "Daily Analytics Review",
    ["0 10 * * *"],
    `ตรวจข้อมูลและ Event ที่เข้าถึงได้
สรุป traffic, click, conversion, anomaly และสิ่งที่ควรตรวจต่อ
ห้ามสร้างตัวเลขเมื่อไม่มีข้อมูล`
  ],

  [
    "SEO Agent",
    "SEO Health Check",
    ["30 11 * * 1,4"],
    `ตรวจ SEO health:
title, meta, canonical, robots, sitemap, headings, internal links และ technical issues
จัดลำดับ Critical / Important / Improvement`
  ],

  [
    "Content Agent",
    "Content Opportunity",
    ["0 13 * * *"],
    `คิด Content Opportunity สำหรับ CHAYLUEKLAB
เสนอ 3 แนวคิดพร้อม Hook, format และเป้าหมาย
เป็น Draft เท่านั้น`
  ],

  [
    "Automation Agent",
    "Automation Health Check",
    ["0 15 * * *"],
    `ตรวจระบบ automation ที่เข้าถึงได้
หา workflow failure, scheduler issue, webhook issue และงานซ้ำ
สรุปสิ่งผิดปกติและวิธีแก้`
  ],

  [
    "QA Agent 2",
    "Risk Review",
    ["0 17 * * *"],
    `ตรวจงานที่อาจกระทบ Production เงิน ลูกค้า หรือข้อมูล
สรุปเฉพาะรายการที่ต้องระวังหรือรอ Approval`
  ],

  [
    "CHAYLUEKLAB Boss",
    "Evening Command Report",
    ["30 18 * * *"],
    `สรุปงานประจำวัน:
เสร็จแล้ว / กำลังทำ / รออนุมัติ / มีปัญหา / งานสำคัญถัดไป
สรุปไม่เกิน 12 บรรทัด`
  ]
];

// ============================================================
// VALIDATION
// ============================================================

const names =
  BOTS.map(
    b =>
      b[1]
  );

assert.equal(
  BOTS.length,
  15,
  "CHAYLUEKLAB must have exactly 15 Agents"
);

assert.equal(
  new Set(names).size,
  BOTS.length,
  "duplicate Agent names"
);

for (
  const [
    section,
    name,
    title,
    role
  ] of BOTS
) {

  assert.ok(
    section.length >
    0,
    `${name}: empty section`
  );

  assert.ok(
    name.length <=
    MAX_NAME,
    `${name}: name too long`
  );

  assert.ok(
    title.length <=
    MAX_TITLE,
    `${name}: title too long`
  );

  const instructions =
    instructionsOf(role);

  assert.ok(
    instructions.length <=
    MAX_INSTRUCTIONS,
    `${name}: instructions too long`
  );
}

for (
  const [
    group,
    members
  ] of GROUPS
) {

  assert.ok(
    members.length >= 2 &&
    members.length <= 6,
    `${group}: Rakazo groups require 2-6 members`
  );

  for (
    const member of members
  ) {

    assert.ok(
      names.includes(member),
      `${group}: unknown Agent ${member}`
    );
  }
}

for (
  const [
    bot,
    routineName,
    crons
  ] of ROUTINES
) {

  assert.ok(
    names.includes(bot),
    `Routine ${routineName}: unknown Agent ${bot}`
  );

  assert.ok(
    routineName.length <=
    MAX_NAME,
    `Routine name too long: ${routineName}`
  );

  assert.ok(
    crons.length >
    0,
    `Routine ${routineName}: no cron`
  );
}

// ============================================================
// DRY RUN
// ============================================================

if (DRY) {

  console.log(
    "\nCHAYLUEKLAB AI COMMAND CENTER\n"
  );

  console.table(
    BOTS.map(
      (
        [
          section,
          name,
          title,
          role
        ]
      ) => ({
        section,
        name,
        title,
        instructions:
          instructionsOf(role).length
      })
    )
  );

  console.log(
    "\nGROUPS"
  );

  for (
    const [
      group,
      members
    ] of GROUPS
  ) {

    console.log(
      `${group}: ${members.join(", ")}`
    );
  }

  console.log(
    "\nROUTINES"
  );

  for (
    const [
      bot,
      routineName,
      crons
    ] of ROUTINES
  ) {

    console.log(
      `${bot} / ${routineName} / ${crons.join(", ")} / Asia/Bangkok`
    );
  }

  console.log(
    "\nApproval rules:",
    APPROVALS
      .map(
        x =>
          x[1]
      )
      .join(", ")
  );

  console.log(
    "\nDry run OK"
  );

  process.exit(0);
}

// ============================================================
// CONNECT TO EXISTING APP
// Original project exposes Rakazo through App.call("rk", ...)
// ============================================================

const c =
  await connect(9224);

const rk =
  (
    path,
    input = {}
  ) =>
    c.evaluate(
      `App.call("rk", ${JSON.stringify({
        path,
        input
      })})`
    );

try {

  let boot =
    await rk(
      "bootstrap"
    );

  const palette =
    await c.evaluate(
      "App.PALETTE.map(p => p[0])"
    );

  const botId =
    new Map(
      boot.bots.map(
        b =>
          [
            b.name,
            b.id
          ]
      )
    );

  const sectionId =
    new Map(
      boot.botSections.map(
        s =>
          [
            s.name,
            s.id
          ]
      )
    );

  let createdBots =
    0;

  let updatedBots =
    0;

  // ==========================================================
  // CREATE / UPDATE AGENTS
  // ==========================================================

  for (
    const [
      index,
      [
        section,
        name,
        title,
        role
      ]
    ] of BOTS.entries()
  ) {

    const instructions =
      instructionsOf(
        role
      );

    const existing =
      boot.bots.find(
        b =>
          b.id ===
          botId.get(name)
      );

    if (
      REWRITE &&
      existing &&
      (
        existing.instructions !==
          instructions ||
        existing.title !==
          title
      )
    ) {

      await rk(
        "bots/update",
        {
          botId:
            existing.id,

          title,

          instructions
        }
      );

      updatedBots++;

      console.log(
        "updated",
        name
      );
    }

    if (
      !botId.has(name)
    ) {

      const bot =
        await rk(
          "bots/create",
          {
            name,

            title,

            instructions,

            color:
              palette[
                index %
                palette.length
              ],

            computerMode:
              "dedicated",

            notifyOnFinish:
              true
          }
        );

      botId.set(
        name,
        bot.id
      );

      createdBots++;

      console.log(
        "created",
        name
      );
    }

    const id =
      botId.get(name);

    if (
      !sectionId.has(
        section
      )
    ) {

      const madeSection =
        await rk(
          "botSections/create",
          {
            botId:
              id,

            name:
              section
          }
        );

      sectionId.set(
        section,
        madeSection.id
      );
    }

    // Refresh bot lookup because a newly-created bot
    // is not inside the original bootstrap snapshot.
    const current =
      existing;

    if (
      !current ||
      current.sectionId !==
        sectionId.get(section)
    ) {

      await rk(
        "bots/update",
        {
          botId:
            id,

          sectionId:
            sectionId.get(
              section
            )
        }
      );
    }
  }

  // ==========================================================
  // GROUPS
  // ==========================================================

  boot =
    await rk(
      "bootstrap"
    );

  const existingGroups =
    new Map(
      boot.groups.map(
        g =>
          [
            g.name,
            g.id
          ]
      )
    );

  let createdGroups =
    0;

  for (
    const [
      groupName,
      members
    ] of GROUPS
  ) {

    if (
      !existingGroups.has(
        groupName
      )
    ) {

      await rk(
        "groups/create",
        {
          name:
            groupName,

          botIds:
            members.map(
              name =>
                botId.get(
                  name
                )
            )
        }
      );

      createdGroups++;

      console.log(
        "created group",
        groupName
      );
    }
  }

  // ==========================================================
  // APPROVAL RULES
  // ==========================================================

  const rules =
    await rk(
      "approvalRules/list"
    );

  let createdRules =
    0;

  for (
    const [
      matchKind,
      matchValue
    ] of APPROVALS
  ) {

    const same =
      rules.filter(
        r =>
          r.matchKind ===
            matchKind &&
          r.matchValue
            .toLowerCase() ===
            matchValue
              .toLowerCase()
      );

    // Remove any conflicting "always allow" rule.
    for (
      const
