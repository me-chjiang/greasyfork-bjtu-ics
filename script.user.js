// ==UserScript==
// @name         北交大iCalender课表生成
// @namespace    https://github.com/ZiuChen/userscript
// @version      1.6.1
// @description  导出ics/csv/json格式的日程文件！ 💻支持多端同步！ 📝支持Excel编辑！ 📆支持导入各系统原生日历！
// @author       ZiuChen, ChJiang-ME
// @match        https://aa.bjtu.edu.cn/course_selection/courseselect/stuschedule/*
// @match        https://aa.bjtu.edu.cn/course_selection/courseselecttask/schedule/
// @require      https://fastly.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js
// @require      https://fastly.jsdelivr.net/gh/nwcell/ics.js@dfec67f37a3c267b3f97dd229c9b6a3521222794/demo/ics.deps.min.js
// @icon         https://fastly.jsdelivr.net/gh/ZiuChen/ZiuChen@main/avatar.jpg
// @grant        GM_xmlhttpRequest
// @connect      bksy.bjtu.edu.cn
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/430918/%E5%8C%97%E4%BA%A4%E5%A4%A7iCalender%E8%AF%BE%E8%A1%A8%E7%94%9F%E6%88%90.user.js
// @updateURL https://update.greasyfork.org/scripts/430918/%E5%8C%97%E4%BA%A4%E5%A4%A7iCalender%E8%AF%BE%E8%A1%A8%E7%94%9F%E6%88%90.meta.js
// ==/UserScript==

"use strict"

const defaultStartMonday = "2022-08-29" // 第一个教学周的第一个周一（校历获取失败时的兜底默认值）

if (localStorage.getItem("defaultStartMonday") === null) {
  localStorage.setItem("defaultStartMonday", defaultStartMonday)
}

// 脚本自己管理的全部 localStorage key，重置设置时只清这些，不影响宿主页面自己的数据
const OWNED_STORAGE_KEYS = ["defaultStartMonday", "selectedSemesterId", "semesterCalendarCache"]

const STANDARD_TIME_TABLE = [
  ["08:00", "09:50"],
  ["10:10", "12:00"],
  ["12:10", "14:00"],
  ["14:10", "16:00"],
  ["16:20", "18:10"],
  ["19:00", "20:50"],
  ["21:00", "21:50"]
]

// 错峰上课：以下教学楼第二节（及其他节次）的上下课时间与标准时间不同
const DELAY_CLASSROOMS = ["思源西楼", "逸夫"]
const DELAY_TIME_TABLE = [
  ["08:00", "09:50"],
  ["10:30", "12:20"],
  ["12:10", "14:00"],
  ["14:10", "16:00"],
  ["16:20", "18:10"],
  ["19:00", "20:50"],
  ["21:00", "21:50"]
]

function buttonGenerate() {
  $(".widget-title").append(/* html */ `
        <button id="scheduleIcsGenerate" class="btn btn-white btn-xs">导出为ics文件</button>
        <button id="csvGenerate" class="btn btn-white btn-xs">导出为csv文件</button>
        <button id="jsonGenerate" class="btn btn-white btn-xs">导出为json文件</button>
        <button id="scheduleRedirect" title="点击跳转校历" class="btn btn-white btn-xs">校历</button>
        <select id="semesterSelect" class="form-control" title="用于计算课程日期的学期，默认自动选中当前学期" style="height: 26px;width: 220px;display: inline;vertical-align: middle;">
          <option value="">校历加载中...</option>
        </select>
        <button id="refreshCalendar" title="重新获取校历" class="btn btn-white btn-xs">刷新校历</button>
        <input id="startMonday" class="form-control" type="text" placeholder="校历获取失败时的手动起始周一" title="校历获取失败时的手动起始周一（兜底/覆盖）" style="height: 26px;width: 200px;display: inline;vertical-align: middle;"></input>
        <button id="restoreSetting" title="点击重置设置" class="btn btn-white btn-xs">重置</button>
        `)
  bindEvents()
}

function bindEvents() {
  $("#scheduleRedirect").click(() => {
    window.open("https://bksy.bjtu.edu.cn/Semester.html")
  })
  let pageFlag = 0
  if (window.location.href.search("/courseselect/stuschedule/") != -1) {
    // 本学期课表
  } else if (window.location.href.search("/courseselecttask/schedule/") != -1) {
    // 选课课表
    pageFlag = 1
  }
  // 导出流程里任何一步抛错都要让用户看见，而不是"点了按钮没反应"
  $("#scheduleIcsGenerate").click(() => {
    runExport("导出为ics文件", () => icsmain(pageFlag))
  })
  $("#csvGenerate").click(() => {
    runExport("导出为csv文件", () => csvmain(pageFlag))
  })
  $("#jsonGenerate").click(() => {
    runExport("导出为json文件", () => jsonmain(pageFlag))
  })
  $("#restoreSetting").click(() => {
    OWNED_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
    location.reload()
  })
  $("#startMonday")
    .change((e) => {
      localStorage.setItem("defaultStartMonday", e.target.value)
    })
    .val(localStorage.getItem("defaultStartMonday"))

  $("#semesterSelect").change((e) => {
    localStorage.setItem("selectedSemesterId", e.target.value)
  })
  $("#refreshCalendar").click(() => {
    getSemesterCalendar(true)
      .then((cache) => populateSemesterSelect(cache))
      .catch((err) => alert("刷新校历失败：" + err.message))
  })

  getSemesterCalendar(false)
    .then((cache) => populateSemesterSelect(cache))
    .catch((err) => {
      $("#semesterSelect").html('<option value="">校历获取失败，将使用手动起始周一</option>')
      console.warn("[课表导出] " + err.message)
    })
}

// 从校历页面（bksy.bjtu.edu.cn）抓取全部学期的教学周日期数据
// 页面把 2012 年至今所有学期的数据内嵌在隐藏输入框 #hidJson 里（URL编码的JSON），
// #ddlSemTitle 下拉框的 <option> 列出所有学期，服务端会把当前学期标记为 selected
function fetchSemesterCalendar() {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: "https://bksy.bjtu.edu.cn/Admin/SemesterTranPage.aspx",
      timeout: 10000,
      onload: (res) => {
        try {
          let doc = new DOMParser().parseFromString(res.responseText, "text/html")
          let hidJson = doc.getElementById("hidJson")
          let options = doc.querySelectorAll("#ddlSemTitle option")
          if (!hidJson || options.length === 0) {
            throw new Error("校历页面结构已变化，无法解析")
          }
          let allData = JSON.parse(decodeURIComponent(hidJson.value))
          let semesters = []
          for (let opt of options) {
            let id = parseInt(opt.value, 10)
            let entry = allData.find((d) => d.Id === id)
            if (!entry) continue
            let weeks = []
            for (let col of entry.Json) {
              let match = col.Week && col.Week.match(/^第(\d+)教学周$/)
              if (!match) continue
              let dtMatch = col.DT && col.DT.match(/\d+/)
              if (!dtMatch) continue
              weeks.push({ week: parseInt(match[1], 10), monday: parseInt(dtMatch[0], 10) })
            }
            semesters.push({
              id: id,
              name: opt.textContent.trim(),
              selected: opt.hasAttribute("selected"),
              weeks: weeks
            })
          }
          if (semesters.length === 0) {
            throw new Error("未解析到任何学期数据")
          }
          let cache = { fetchedAt: Date.now(), semesters: semesters }
          localStorage.setItem("semesterCalendarCache", JSON.stringify(cache))
          resolve(cache)
        } catch (e) {
          reject(e)
        }
      },
      onerror: () => reject(new Error("获取校历失败：网络错误")),
      ontimeout: () => reject(new Error("获取校历超时"))
    })
  })
}

// 24小时内优先用缓存，避免每次点击都请求校历页面
function getSemesterCalendar(forceRefresh) {
  if (!forceRefresh) {
    let cache = readCalendarCache()
    if (cache && Date.now() - cache.fetchedAt < 24 * 60 * 60 * 1000) {
      return Promise.resolve(cache)
    }
  }
  return fetchSemesterCalendar()
}

// 安全读取校历缓存：内容损坏时只丢弃缓存并继续，而不是让脚本整体崩掉
function readCalendarCache() {
  let raw = localStorage.getItem("semesterCalendarCache")
  if (!raw) return null
  try {
    let cache = JSON.parse(raw)
    if (!cache || !Array.isArray(cache.semesters)) throw new Error("缓存结构异常")
    return cache
  } catch (e) {
    console.warn("[课表导出] 校历缓存已损坏，已丢弃：" + e.message)
    localStorage.removeItem("semesterCalendarCache")
    return null
  }
}

// 统一兜住导出流程中的异常，保证失败时用户能看到原因
function runExport(label, fn) {
  try {
    let result = fn()
    if (result && typeof result.catch === "function") {
      result.catch((err) => {
        console.error("[课表导出] " + label + "失败", err)
        alert(label + "失败：" + (err && err.message ? err.message : err))
      })
    }
  } catch (err) {
    console.error("[课表导出] " + label + "失败", err)
    alert(label + "失败：" + (err && err.message ? err.message : err))
  }
}

function populateSemesterSelect(cache) {
  let $sel = $("#semesterSelect")
  $sel.empty()
  for (let sem of cache.semesters) {
    $sel.append(`<option value="${sem.id}">${sem.name}</option>`)
  }
  let savedId = localStorage.getItem("selectedSemesterId")
  let defaultSem = cache.semesters.find((s) => s.selected)
  let idToSelect = savedId && cache.semesters.some((s) => String(s.id) === savedId) ? savedId : defaultSem && defaultSem.id
  if (idToSelect != null) $sel.val(idToSelect)
}

// 生成 {教学周编号: [7个Date]} 的映射。
// 优先用当前选中学期从校历抓到的精确日期（自动跳过放假整周，无偏移）；
// 校历数据不可用时，回退到旧的"起始周一 + 7×N天"线性推算
function buildWeekTable() {
  let cache = readCalendarCache()
  let selectedId = $("#semesterSelect").val()
  let semester = cache && cache.semesters.find((s) => String(s.id) === String(selectedId))

  if (semester && semester.weeks.length > 0) {
    let table = {}
    for (let entry of semester.weeks) {
      let days = []
      for (let j = 0; j < 7; j++) {
        let d = new Date(entry.monday)
        d.setDate(d.getDate() + j)
        days.push(d)
      }
      table[entry.week] = days
    }
    return table
  }

  // 兜底：线性推算。这条路径无法跳过整周放假，且默认值可能早已过期，必须明确提示用户
  let startMondayString = $("#startMonday").val()
  if (validCheck(startMondayString) === false) return null
  let startMonday = new Date(startMondayString)
  if (Math.abs(Date.now() - startMonday.getTime()) > 180 * 24 * 60 * 60 * 1000) {
    alert(
      "未能从校历获取教学周日期，正在按“起始周一 " +
        startMondayString +
        "”线性推算。\n该日期距今天超过半年，很可能是过期的默认值，导出的日期会整体错位。\n" +
        "建议先点击“刷新校历”，或在“起始周一”输入框中填写本学期第一个教学周的周一。"
    )
  }
  let table = {}
  for (let i = 0; i < 30; i++) {
    let days = []
    for (let j = 0; j < 7; j++) {
      let d = new Date(startMonday)
      d.setDate(d.getDate() + 7 * i + j)
      days.push(d)
    }
    table[i + 1] = days
  }
  return table
}

function validCheck(startMondayString) {
  const re = new RegExp(/^\d{4}-\d{1,2}-\d{1,2}/)
  if (re.test(startMondayString) === false) {
    alert("输入日期值非法，请重新输入。")
    return false
  }
  return true
}

function tableTransfer(rowTable) {
  // 7*7行转列
  let tmpTable = []
  let columnTable = []
  for (let i = 0; i < 7; i++) {
    for (let j = i; j < 49; j += 7) {
      tmpTable.push(rowTable[j])
    }
    columnTable[i] = tmpTable
    tmpTable = []
  }
  return columnTable
}

function removeZero(iArr) {
  for (let i = 0; i < iArr.length; i++) {
    iArr[i] = parseInt(iArr[i], 10)
  }
  return iArr
}

function dateStr2Arr(dateStr) {
  let dateArr = []
  if (dateStr) {
    if (/[-－]/.test(dateStr)) {
      // 第X-Y周
      let indexArr = dateStr.split(/[-－]/)
      removeZero(indexArr)
      if (isNaN(indexArr[0]) || isNaN(indexArr[1])) {
        console.warn(`[课表导出] 无法解析周次范围字符串 "${dateStr}"，已跳过`)
      } else {
        for (let i = indexArr[0]; i < indexArr[1] + 1; i++) {
          dateArr.push(i)
        }
      }
    } else if (/[,，、]/.test(dateStr)) {
      // 单双周
      dateArr = dateStr.split(/[,，、]\s*/)
      removeZero(dateArr)
      let invalidCount = dateArr.filter((n) => isNaN(n)).length
      if (invalidCount > 0) {
        console.warn(`[课表导出] 无法解析周次字符串 "${dateStr}"，已跳过 ${invalidCount} 项`)
        dateArr = dateArr.filter((n) => !isNaN(n))
      }
    } else {
      let singleWeek = parseInt(dateStr, 10)
      if (isNaN(singleWeek)) {
        console.warn(`[课表导出] 无法解析周次字符串 "${dateStr}"，已跳过`)
      } else {
        dateArr.push(singleWeek) // 第X周
      }
    }
  }
  return dateArr
}

// courseList[x]示例：
// allInfo: "国际贸易实务模拟 第03-06周思源东楼 SD401卜伟"
// courseNum: 1
// date: (4) [3, 4, 5, 6]
// initInfo: "第03-06周"
// location: "思源东楼 SD401"
// name: "国际贸易实务模拟 "
// teacher: "卜伟"
// weekNum: 6

// 把页面上的周次文本解析成 { initInfo, date }。
// 支持 "第03-06周"、"第5周"、"第3,5,7周"、"第1-16周(单)"、"第1-16周（双周）" 等写法。
// 尾部的单/双周标记以前会被 substring 直接截掉，导致单双周课程被导出成每周都有
function parseWeekSpec(rawText) {
  let text = String(rawText == null ? "" : rawText).replace(/[\s\u3000]/g, "")
  let markerText = ""
  if (/单/.test(text)) markerText = "单"
  else if (/双/.test(text)) markerText = "双"

  let weekEnd = text.indexOf("周")
  let weekStart = text.indexOf("第")
  let body
  if (weekEnd !== -1 && (weekStart === -1 || weekEnd > weekStart)) {
    body = text.substring(weekStart + 1, weekEnd)
  } else {
    body = text.replace(/[（(][^）)]*[）)]/g, "")
  }

  let weeks = dateStr2Arr(body)
  if (markerText === "单") weeks = weeks.filter((w) => w % 2 === 1)
  else if (markerText === "双") weeks = weeks.filter((w) => w % 2 === 0)

  let initInfo = "第" + body + "周" + (markerText ? "(" + markerText + ")" : "")
  if (weeks.length === 0) {
    console.warn(`[课表导出] 周次文本 "${rawText}" 未解析出任何教学周`)
  }
  return { initInfo: initInfo, date: weeks }
}

function stuScheduleGetTable() {
  let courseListTmp = tableTransfer($("tr>td[style!='height:80px;']"))
  let courseList = []
  let courseTmp = {}
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      let cell = courseListTmp[i][j]
      if (!cell) continue
      let nameNodes = cell.querySelectorAll('span[style="color:#000"]')
      let locationNodes = cell.querySelectorAll('span[class="text-muted"]')
      let dateNodes = cell.querySelectorAll('div[style="max-width:120px;"]')
      let teacherNodes = cell.querySelectorAll("i")
      for (let k = 0; k < nameNodes.length; k++) {
        // 各字段是按索引一一对应的，页面结构一旦不齐就跳过该条，而不是整体抛错
        if (!nameNodes[k] || !locationNodes[k] || !dateNodes[k]) {
          console.warn("[课表导出] 课表单元格结构与预期不符，已跳过一条课程记录")
          continue
        }
        courseTmp.weekNum = i + 1
        courseTmp.courseNum = j + 1
        courseTmp.name = nameNodes[k].innerText.split("[本")[0]
        courseTmp.location = locationNodes[k].innerText
        let weekSpec = parseWeekSpec(dateNodes[k].innerText)
        courseTmp.initInfo = weekSpec.initInfo
        courseTmp.date = weekSpec.date
        courseTmp.teacher = teacherNodes[k] ? teacherNodes[k].innerText : ""
        courseTmp.allInfo =
          courseTmp.name +
          " " +
          courseTmp.initInfo +
          " " +
          courseTmp.location +
          " " +
          courseTmp.teacher
        courseList.push(courseTmp)
        courseTmp = {}
      }
    }
  }
  return courseList
}

function scheduleGetTable() {
  let courseListTmp = tableTransfer($("tr>td[style!='height:80px;']"))
  let courseList = []
  let courseTmp = {}
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      let cell = courseListTmp[i][j]
      if (!cell) continue
      let spanNodes = cell.getElementsByTagName("span")
      let locationNodes = cell.querySelectorAll('span[class="text-muted"]')
      let dateNodes = cell.querySelectorAll('div[style="max-width:120px;"]')
      let teacherNodes = cell.querySelectorAll("i")
      for (let k = 0; k < dateNodes.length; k++) {
        if (!spanNodes[k * 3] || !locationNodes[k] || !dateNodes[k]) {
          console.warn("[课表导出] 课表单元格结构与预期不符，已跳过一条课程记录")
          continue
        }
        courseTmp.weekNum = i + 1
        courseTmp.courseNum = j + 1
        courseTmp.name = spanNodes[k * 3].innerText.split("\n")[1] || ""
        courseTmp.location = locationNodes[k].innerText
        let weekSpec = parseWeekSpec(dateNodes[k].innerText)
        courseTmp.initInfo = weekSpec.initInfo
        courseTmp.date = weekSpec.date
        courseTmp.teacher = teacherNodes[k] ? teacherNodes[k].innerText : ""
        courseTmp.allInfo =
          courseTmp.name +
          " " +
          courseTmp.initInfo +
          " " +
          courseTmp.location +
          " " +
          courseTmp.teacher
        courseList.push(courseTmp)
        courseTmp = {}
      }
    }
  }
  return courseList
}

function timeConstructor(weekTable, weekTh, weekNum, courseNum, isStamp, locationStr) {
  let location = locationStr == null ? "" : String(locationStr)
  let isDelayed = DELAY_CLASSROOMS.some((item) => location.search(item) != -1)
  let timeTable = isDelayed ? DELAY_TIME_TABLE : STANDARD_TIME_TABLE

  let weekDays = weekTable ? weekTable[weekTh] : null
  let dayTime = weekDays ? weekDays[weekNum - 1] : null
  let period = timeTable[courseNum - 1]
  if (!dayTime || !period) return null // 该教学周不在校历数据里，由调用方跳过

  let DayTime = new Date(dayTime)
  let startTimeStamp, endTimeStamp

  startTimeStamp = DayTime.setHours(
    period[0].split(":")[0],
    period[0].split(":")[1]
  )
  endTimeStamp = DayTime.setHours(
    period[1].split(":")[0],
    period[1].split(":")[1]
  )

  if (isStamp === 1) {
    return [startTimeStamp, endTimeStamp]
  }

  return [new Date(startTimeStamp).toString(), new Date(endTimeStamp).toString()]
}

function icsConstructor(icsEventList) {
  let cal = ics()
  let today = new Date()
  today = today.toLocaleDateString()
  for (let i = 0; i < icsEventList.length; i++) {
    cal.addEvent(
      icsEventList[i].name,
      icsEventList[i].description,
      icsEventList[i].location,
      icsEventList[i].startTime,
      icsEventList[i].endTime
    )
  }
  cal.download("iCalender - 课表 - " + today)
}

function eventConstructor(courseList, weekTable) {
  let icsEventList = []
  let skipped = 0
  for (let i = 0; i < courseList.length; i++) {
    for (let j = 0; j < courseList[i].date.length; j++) {
      let timeRst = timeConstructor(
        weekTable,
        courseList[i].date[j],
        courseList[i].weekNum,
        courseList[i].courseNum,
        0,
        courseList[i].location
      )
      let timeRstStamp = timeConstructor(
        weekTable,
        courseList[i].date[j],
        courseList[i].weekNum,
        courseList[i].courseNum,
        1,
        courseList[i].location
      )
      if (!timeRst || !timeRstStamp) {
        skipped++
        console.warn(
          `[课表导出] 跳过无法定位日期的课程：${courseList[i].name} ${courseList[i].initInfo}（第${courseList[i].date[j]}教学周不在校历数据中）`
        )
        continue
      }
      icsEventList.push({
        name: courseList[i].name,
        description:
          courseList[i].location +
          " " +
          courseList[i].initInfo +
          " 任课教师：" +
          courseList[i].teacher,
        location: courseList[i].location,
        startTime: timeRst[0],
        endTime: timeRst[1],
        startTimeStamp: timeRstStamp[0],
        endTimeStamp: timeRstStamp[1]
      })
    }
  }
  return { events: icsEventList, skipped: skipped }
}

function toExcelFormatter(courseList) {
  let charArr = ["第一节", "第二节", "第三节", "第四节", "第五节", "第六节", "第七节"]
  // column1 是"节次"标签，column2~column8 对应周一~周日。
  // 以前只有 column1~column7，最后一周（周日）的课程会被写进名为 "undefined" 的键，导致 CSV 多出一列
  let jsonData = []
  for (let i = 0; i < 7; i++) {
    let row = {
      column1: charArr[i] + " [" + STANDARD_TIME_TABLE[i][0] + " - " + STANDARD_TIME_TABLE[i][1] + "]"
    }
    for (let j = 0; j < 7; j++) {
      row["column" + (j + 2)] = ""
    }
    jsonData.push(row)
  }
  let objKeys = Object.keys(jsonData[0])

  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      let tmpKey = objKeys[j + 1] // column2~column8
      for (let k = 0; k < courseList.length; k++) {
        if (courseList[k].courseNum == i + 1 && courseList[k].weekNum == j + 1) {
          jsonData[i][tmpKey] = jsonData[i][tmpKey] + "  " + courseList[k].allInfo
        }
      }
    }
  }
  return jsonData
}

// 标准 CSV 字段转义：含逗号/双引号/换行则整体加引号，内部双引号转义为两个双引号
function csvEscape(field) {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

// 拼出 CSV 文本（与下载动作分离，便于单独验证）
function buildCsvString(jsonData) {
  let lines = ["课程|星期,星期一,星期二,星期三,星期四,星期五,星期六,星期日"]
  for (let i = 0; i < jsonData.length; i++) {
    // 用 join 拼行，避免旧实现在每行末尾多留一个逗号（会多出一个空列）
    let cells = Object.keys(jsonData[i]).map((key) => csvEscape(jsonData[i][key] + "\t"))
    lines.push(cells.join(","))
  }
  return lines.join("\n") + "\n"
}

// tableToExcel() @csdn hhzzcc_
function tableToExcel(jsonData) {
  const str = buildCsvString(jsonData)
  const uri = "data:text/csv;charset=utf-8,\ufeff" + encodeURIComponent(str)
  const link = document.createElement("a")
  link.href = uri
  link.download = "课程表.csv"
  link.click()
}

function icsmain(icase) {
  return getSemesterCalendar(false)
    .catch((err) => {
      console.warn("[课表导出] 校历获取失败，将尝试其它日期来源：" + err.message)
      return null
    })
    .then(() => {
      let weekTable = buildWeekTable()
      if (!weekTable) return
      let courseList
      if (icase === 0) {
        courseList = stuScheduleGetTable()
      } else if (icase === 1) {
        courseList = scheduleGetTable()
      } else {
        courseList = []
      }
      let result = eventConstructor(courseList, weekTable)
      if (result.events.length === 0) {
        alert("没有解析到任何可导出的课程，请确认当前页面是课表页面，并检查校历/起始周一的设置。")
        return
      }
      icsConstructor(result.events)
      if (result.skipped > 0) {
        alert(
          `已成功导出 ${result.events.length} 条日程，另有 ${result.skipped} 条课程因所在教学周不在校历数据中而被跳过。\n` +
            "如果数量偏多，请确认上方选择的学期是否正确。"
        )
      }
    })
}

function csvmain(icase) {
  let courseList = icase === 0 ? stuScheduleGetTable() : icase === 1 ? scheduleGetTable() : []
  if (courseList.length === 0) {
    alert("没有解析到任何课程，请确认当前页面是课表页面。")
    return
  }
  tableToExcel(toExcelFormatter(courseList))
}

function jsonmain(icase) {
  let courseList = icase === 0 ? stuScheduleGetTable() : icase === 1 ? scheduleGetTable() : []
  if (courseList.length === 0) {
    alert("没有解析到任何课程，请确认当前页面是课表页面。")
    return
  }
  const uri = "data:text/json;charset=utf-8,\ufeff" + encodeURIComponent(JSON.stringify(courseList))
  const link = document.createElement("a")
  link.href = uri
  link.download = "课程表.json"
  link.click()
}

buttonGenerate()
