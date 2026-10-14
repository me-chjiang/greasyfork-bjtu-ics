// 纯 Node 测试，无第三方依赖：node test/run-tests.js
//
// script.user.js 是油猴脚本，没有模块导出，这里用文本提取的方式把其中的纯函数
// （不依赖 jQuery / DOM 的那部分）取出来求值，从而对这些逻辑做回归验证。
// 如果改动导致提取失败，测试会直接报错——这也是对源码结构的一种保护。

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const SRC_PATH = path.join(__dirname, "..", "script.user.js")
const src = fs.readFileSync(SRC_PATH, "utf8")

// 从 header 之后第一个 open 字符开始做括号配对，返回完整声明文本
function sliceBalanced(text, header, open, close) {
  const start = text.indexOf(header)
  if (start < 0) throw new Error(`提取失败，源码中找不到声明：${header}`)
  const openIdx = text.indexOf(open, start)
  if (openIdx < 0) throw new Error(`提取失败，声明后找不到 ${open}：${header}`)
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  throw new Error(`提取失败，括号未闭合：${header}`)
}

const extractFunction = (name) => sliceBalanced(src, `function ${name}(`, "{", "}")
const extractArrayConst = (name) => sliceBalanced(src, `const ${name} = `, "[", "]")

const pieces = [
  extractArrayConst("STANDARD_TIME_TABLE"),
  extractArrayConst("DELAY_TIME_TABLE"),
  extractArrayConst("DELAY_CLASSROOMS"),
  extractFunction("removeZero"),
  extractFunction("dateStr2Arr"),
  extractFunction("parseWeekSpec"),
  extractFunction("timeConstructor"),
  extractFunction("eventConstructor"),
  extractFunction("toExcelFormatter"),
  extractFunction("csvEscape"),
  extractFunction("buildCsvString")
]

const exported = new Function(
  `"use strict";\n${pieces.join("\n")}\n` +
    "return { STANDARD_TIME_TABLE, DELAY_TIME_TABLE, DELAY_CLASSROOMS, dateStr2Arr, parseWeekSpec, timeConstructor, eventConstructor, toExcelFormatter, csvEscape, buildCsvString };"
)()

const {
  STANDARD_TIME_TABLE,
  dateStr2Arr,
  parseWeekSpec,
  timeConstructor,
  eventConstructor,
  toExcelFormatter,
  csvEscape,
  buildCsvString
} = exported

// ---- 极简测试框架 ----
const failures = []
let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.log(`FAIL  ${name}\n      ${err.message}`)
  }
}

const monday = new Date(2026, 7, 31) // 2026-08-31（周一）
function weekTableFrom(mondays) {
  const table = {}
  for (const [week, m] of Object.entries(mondays)) {
    const days = []
    for (let j = 0; j < 7; j++) {
      const d = new Date(m)
      d.setDate(d.getDate() + j)
      days.push(d)
    }
    table[week] = days
  }
  return table
}
const weekTable = weekTableFrom({ 1: monday, 2: new Date(2026, 8, 7) })
const hm = (ts) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

console.log("\ndateStr2Arr")
test("解析周次区间 03-06", () => assert.deepStrictEqual(dateStr2Arr("03-06"), [3, 4, 5, 6]))
test("解析全角连字符 3－5", () => assert.deepStrictEqual(dateStr2Arr("3－5"), [3, 4, 5]))
test("解析不连续周次 3,5,7", () => assert.deepStrictEqual(dateStr2Arr("3,5,7"), [3, 5, 7]))
test("解析中文逗号/顿号 3，5、9", () => assert.deepStrictEqual(dateStr2Arr("3，5、9"), [3, 5, 9]))
test("解析单周 7", () => assert.deepStrictEqual(dateStr2Arr("7"), [7]))
test("无法解析时返回空数组而不是 NaN", () => assert.deepStrictEqual(dateStr2Arr("abc"), []))

console.log("\nparseWeekSpec（含单双周）")
test("第03-06周", () => {
  const spec = parseWeekSpec("第03-06周")
  assert.strictEqual(spec.initInfo, "第03-06周")
  assert.deepStrictEqual(spec.date, [3, 4, 5, 6])
})
test("第5周", () => assert.deepStrictEqual(parseWeekSpec("第5周").date, [5]))
test("第3,5,7周", () => assert.deepStrictEqual(parseWeekSpec("第3,5,7周").date, [3, 5, 7]))
test("第1-16周(单) 只保留奇数周（原实现会丢掉单双周标记）", () => {
  const spec = parseWeekSpec("第1-16周(单)")
  assert.deepStrictEqual(spec.date, [1, 3, 5, 7, 9, 11, 13, 15])
  assert.strictEqual(spec.initInfo, "第1-16周(单)")
})
test("第1-16周（双周）只保留偶数周", () =>
  assert.deepStrictEqual(parseWeekSpec("第1-16周（双周）").date, [2, 4, 6, 8, 10, 12, 14, 16]))
test("缺少“第…周”包裹时也能解析 1-16周(双)", () =>
  assert.deepStrictEqual(parseWeekSpec("1-16周(双)").date, [2, 4, 6, 8, 10, 12, 14, 16]))
test("含空格/全角空格的文本", () =>
  assert.deepStrictEqual(parseWeekSpec(" 第 3 - 6 周 ").date, [3, 4, 5, 6]))

console.log("\ntimeConstructor")
test("普通教室按标准时间", () => {
  const [s] = timeConstructor(weekTable, 1, 1, 2, 1, "思源东楼 SD401")
  assert.strictEqual(hm(s), STANDARD_TIME_TABLE[1][0])
})
test("思源西楼第二节按错峰时间 10:30", () =>
  assert.strictEqual(hm(timeConstructor(weekTable, 1, 1, 2, 1, "思源西楼 101")[0]), "10:30"))
test("逸夫第二节按错峰时间 10:30", () =>
  assert.strictEqual(hm(timeConstructor(weekTable, 1, 1, 2, 1, "逸夫教学楼 201")[0]), "10:30"))
test("思源西楼第一节与标准时间一致", () =>
  assert.strictEqual(hm(timeConstructor(weekTable, 1, 1, 1, 1, "思源西楼 101")[0]), "08:00"))
test("校历中不存在的教学周返回 null 而不是抛错", () =>
  assert.strictEqual(timeConstructor(weekTable, 9, 1, 1, 1, "思源东楼"), null))
test("location 为 undefined 时不抛错", () =>
  assert.strictEqual(hm(timeConstructor(weekTable, 1, 1, 1, 1, undefined)[0]), "08:00"))
test("返回时间为当天日期", () => {
  const [s] = timeConstructor(weekTable, 2, 3, 1, 1, "思源东楼")
  assert.strictEqual(new Date(s).getDay(), 3) // 第2周周三
})

console.log("\neventConstructor")
test("跳过校历中缺失的教学周并计数", () => {
  const courseList = [
    { name: "A", initInfo: "第1-2周", location: "思源东楼", teacher: "T", weekNum: 1, courseNum: 1, date: [1, 9] }
  ]
  const result = eventConstructor(courseList, weekTable)
  assert.strictEqual(result.events.length, 1)
  assert.strictEqual(result.skipped, 1)
  assert.strictEqual(result.events[0].name, "A")
})
test("正常课程全部生成事件", () => {
  const courseList = [
    { name: "A", initInfo: "第1-2周", location: "思源东楼", teacher: "T", weekNum: 1, courseNum: 1, date: [1, 2] }
  ]
  const result = eventConstructor(courseList, weekTable)
  assert.strictEqual(result.events.length, 2)
  assert.strictEqual(result.skipped, 0)
})

console.log("\ntoExcelFormatter / buildCsvString")
const courses = [
  { name: "周一课", initInfo: "第1周", location: "A", teacher: "T", allInfo: "周一课 第1周 A T", weekNum: 1, courseNum: 1 },
  { name: "周日课", initInfo: "第1周", location: "A", teacher: "T", allInfo: "周日课 第1周 A T", weekNum: 7, courseNum: 1 }
]
const table = toExcelFormatter(courses)
test("每行有 column1~column8（标签 + 周一~周日）", () =>
  assert.deepStrictEqual(Object.keys(table[0]), [
    "column1",
    "column2",
    "column3",
    "column4",
    "column5",
    "column6",
    "column7",
    "column8"
  ]))
test("不再出现名为 undefined 的列", () =>
  assert.ok(!Object.keys(table[0]).includes("undefined")))
test("周一课落在 column2", () => assert.ok(table[0].column2.includes("周一课")))
test("周日课落在 column8", () => assert.ok(table[0].column8.includes("周日课")))
test("CSV 无 undefined 字样", () => assert.ok(!buildCsvString(table).includes("undefined")))
test("CSV 每行列数与表头一致", () => {
  const lines = buildCsvString(table).trimEnd().split("\n")
  const counts = lines.map((l) => l.split(",").length)
  assert.strictEqual(new Set(counts).size, 1, `列数不一致：${counts.join(", ")}`)
  assert.strictEqual(counts[0], 8)
})
test("CSV 单元格里的逗号被正确转义", () => {
  const escaped = toExcelFormatter([
    { name: "X", initInfo: "第1周", location: "A,B", teacher: "T", allInfo: "X 第1周 A,B T", weekNum: 1, courseNum: 1 }
  ])
  const csv = buildCsvString(escaped)
  assert.ok(csv.includes('"  X 第1周 A,B T'), `含逗号字段应被引号包裹，实际：${csv}`)
})

console.log("\ncsvEscape")
test("普通字段不加引号", () => assert.strictEqual(csvEscape("abc"), "abc"))
test("含逗号字段加引号", () => assert.strictEqual(csvEscape("a,b"), '"a,b"'))
test("双引号转义", () => assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""'))

// ---- 整体加载：用 stub 的浏览器环境跑一遍 script.user.js ----
// 目的：确认脚本能被正常求值（没有引用错误），并且异常处理路径按预期工作
const vm = require("vm")
const alerts = []
const store = {}
function jqStub() {
  const o = {
    append: () => o,
    click: () => o,
    change: () => o,
    html: () => o,
    empty: () => o,
    val(v) {
      return arguments.length ? o : ""
    }
  }
  return o
}
const sandbox = {
  console,
  $: () => jqStub(),
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => {
      delete store[k]
    }
  },
  document: { createElement: () => ({ click() {} }) },
  window: { location: { href: "https://aa.bjtu.edu.cn/course_selection/courseselect/stuschedule/" }, open() {} },
  GM_xmlhttpRequest: () => {},
  DOMParser: function () {
    this.parseFromString = () => ({ getElementById: () => null, querySelectorAll: () => [] })
  },
  ics: () => ({ addEvent() {}, download() {} }),
  alert: (m) => alerts.push(String(m)),
  Date,
  JSON,
  Math,
  Object,
  Array,
  String,
  Number,
  parseInt,
  isNaN,
  Promise,
  RegExp,
  Error,
  encodeURIComponent
}
vm.createContext(sandbox)

;(async () => {
  console.log("\n整体加载（stub 浏览器环境）")
  test("script.user.js 能完整求值", () =>
    vm.runInContext(src, sandbox, { filename: "script.user.js" }))
  test("三个导出入口都可用", () => {
    for (const name of ["icsmain", "csvmain", "jsonmain"]) {
      assert.strictEqual(typeof sandbox[name], "function", `${name} 未定义`)
    }
  })
  test("损坏的校历缓存被丢弃而不是抛错", () => {
    store.semesterCalendarCache = "{不是合法 JSON"
    assert.strictEqual(sandbox.readCalendarCache(), null)
    assert.ok(!("semesterCalendarCache" in store), "损坏缓存应被删除")
  })
  test("runExport 把同步异常暴露给用户", () => {
    alerts.length = 0
    sandbox.runExport("测试导出", () => {
      throw new Error("boom")
    })
    assert.deepStrictEqual(alerts, ["测试导出失败：boom"])
  })
  alerts.length = 0
  sandbox.runExport("测试异步", () => Promise.reject(new Error("async boom")))
  await new Promise((r) => setTimeout(r, 0))
  test("runExport 把 Promise 拒绝暴露给用户", () =>
    assert.deepStrictEqual(alerts, ["测试异步失败：async boom"]))

  console.log(`\n${passed} 通过，${failures.length} 失败`)
  if (failures.length > 0) {
    for (const f of failures) console.error(`\n[${f.name}]\n${f.err.stack}`)
    process.exit(1)
  }
})()
