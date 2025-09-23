// ========================================
// 웨이브파크 Puppeteer 스크래퍼
// Headless 브라우저로 렌더링된 DOM 파싱
// ========================================

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// ===== 설정 =====
const CONFIG = {
  URL: 'https://wavepark.framer.website/',
  TARGET_DATES: ['2024-09-27', '2024-09-28'], // 원하는 날짜
  TARGET_LEVELS: ['초급', '상급'], // 모니터링할 레벨: ['초급'], ['중급'], ['상급'], ['초급', '중급', '상급']
  INCLUDE_TODAY: false, // 오늘 날짜도 포함할지 여부
  INCLUDE_ALL_DATES: false, // 모든 날짜 포함 (테스트용)
  DEBUG: true,
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

// ===== 유틸리티 함수들 =====
// 대기 함수 (waitForTimeout 대체)
function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

// 요소가 나타날 때까지 대기하는 함수
async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    console.log(`요소를 찾을 수 없음: ${selector}`);
    return false;
  }
}

// ===== 메인 스크래핑 함수 =====
async function scrapeWavePark() {
  let browser;
  
  try {
    // 브라우저 시작
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();
    
    // User Agent 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 뷰포트 설정
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 날짜 설정 자동화 옵션
    if (CONFIG.INCLUDE_TODAY) {
      const today = new Date().toISOString().split('T')[0];
      if (!CONFIG.TARGET_DATES.includes(today)) {
        CONFIG.TARGET_DATES.push(today);
        console.log(`오늘 날짜(${today}) 추가됨`);
      }
    }
    
    if (CONFIG.INCLUDE_ALL_DATES) {
      console.log('모든 날짜의 티켓을 모니터링합니다.');
    }
    
    console.log('모니터링 대상:');
    console.log('  - 날짜:', CONFIG.TARGET_DATES);
    console.log('  - 레벨:', CONFIG.TARGET_LEVELS);
    
    console.log('페이지 로딩 중...');
    
    // 페이지 이동
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 추가 대기 (동적 콘텐츠 로딩)
    // waitForTimeout 대신 다른 방법 사용
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 잔여좌우 요소가 로드될 때까지 대기
    const foundElement = await waitForElement(page, '[data-framer-name="잔여좌우"]', 10000);
    if (foundElement) {
      console.log('잔여좌우 요소 발견!');
    } else {
      console.log('잔여좌우 요소를 찾을 수 없습니다. 계속 진행...');
    }
    
    // DOM에서 데이터 추출
    const ticketData = await page.evaluate((CONFIG) => {
      const results = [];
      
      // 모든 텍스트 노드를 순서대로 수집
      const allTexts = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            const text = node.textContent.trim();
            if (text && text.length > 0) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );
      
      let node;
      while (node = walker.nextNode()) {
        allTexts.push({
          text: node.textContent.trim(),
          element: node.parentElement
        });
      }
      
      // 데이터 파싱
      let currentDate = null;
      let currentTime = null;
      let currentLevel = null;
      let dateMap = {}; // 날짜별 인덱스 저장
      
      // 먼저 모든 날짜를 찾아서 위치 저장
      for (let i = 0; i < allTexts.length; i++) {
        const text = allTexts[i].text;
        
        // 날짜 패턴: "9/27 (토)", "9/28 (일)" 등
        const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\s*\([월화수목금토일]\)$/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]);
          const day = parseInt(dateMatch[2]);
          const dateStr = `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          dateMap[i] = dateStr;
          console.log(`날짜 발견: ${text} -> ${dateStr} at index ${i}`);
        }
      }
      
      // 날짜 인덱스를 기준으로 현재 날짜 결정
      function getCurrentDateForIndex(index) {
        let selectedDate = null;
        let minDistance = Infinity;
        
        for (const [dateIndex, date] of Object.entries(dateMap)) {
          const distance = index - parseInt(dateIndex);
          if (distance >= 0 && distance < minDistance) {
            minDistance = distance;
            selectedDate = date;
          }
        }
        
        // 날짜를 못 찾으면 현재 날짜 또는 기본값 사용
        if (!selectedDate) {
          const today = new Date();
          const month = today.getMonth() + 1;
          const day = today.getDate();
          
          // 9월 27일 또는 28일이 가까운 날짜 선택
          if (day <= 27) {
            selectedDate = '2024-09-27';
          } else {
            selectedDate = '2024-09-28';
          }
        }
        
        return selectedDate;
      }
      
      for (let i = 0; i < allTexts.length; i++) {
        const item = allTexts[i];
        const text = item.text;
        
        // 현재 인덱스에 해당하는 날짜 업데이트
        if (dateMap[i]) {
          currentDate = dateMap[i];
        }
        
        // 시간 패턴: "10:00"
        if (text.match(/^\d{2}:00$/)) {
          currentTime = text;
          // 시간이 바뀌면 현재 날짜를 다시 계산
          if (!currentDate) {
            currentDate = getCurrentDateForIndex(i);
          }
        }
        // 레벨 패턴
        else if (text === '상급' || text === '중급' || text === '초급') {
          currentLevel = text;
          
          // 배경색 확인 (더 정확한 레벨 판단)
          const parent = item.element.closest('div[style*="background-color"]');
          if (parent) {
            const style = parent.getAttribute('style');
            if (style) {
              if (style.includes('rgb(239, 68, 68)') || style.includes('rgb(239,68,68)')) {
                currentLevel = '상급';
              } else if (style.includes('rgb(59, 130, 246)') || style.includes('rgb(59,130,246)')) {
                currentLevel = '중급';
              } else if (style.includes('rgb(235, 179, 5)') || style.includes('rgb(235,179,5)')) {
                currentLevel = '초급';
              }
            }
          }
        }
        // 좌석 패턴: "숫자/숫자", "-/숫자", "숫자/-", "매진"
        else if (text.match(/^(-?\d+|-)\/(-?\d+|-)$/) || text === '매진') {
          // 잔여좌우 요소인지 확인
          const isInSeatDiv = item.element.closest('[data-framer-name="잔여좌우"]') !== null;
          
          if (isInSeatDiv || (currentLevel && i - allTexts.findIndex(t => t.text === currentLevel) < 10)) {
            let leftSeats = 0;
            let rightSeats = 0;
            
            if (text === '매진') {
              leftSeats = 0;
              rightSeats = 0;
            } else if (text.includes('/')) {
              const parts = text.split('/');
              leftSeats = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
              rightSeats = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
            }
            
            // 원하는 레벨만 저장 (CONFIG.TARGET_LEVELS 확인)
            if (CONFIG.TARGET_LEVELS.includes(currentLevel) && (leftSeats + rightSeats) > 0) {
              // 날짜가 없으면 현재 인덱스 기준으로 계산
              const finalDate = currentDate || getCurrentDateForIndex(i);
              
              results.push({
                date: finalDate,
                time: currentTime || '시간미확인',
                level: currentLevel,
                leftSeats: leftSeats,
                rightSeats: rightSeats,
                totalSeats: leftSeats + rightSeats,
                raw: text
              });
              
              console.log(`${currentLevel} 티켓 추가: ${finalDate} ${currentTime} - ${text}`);
            }
          }
        }
      }
      
      // 디버깅: 전체 텍스트 중 일부 출력
      console.log('=== 텍스트 샘플 (날짜/시간/레벨/좌석) ===');
      allTexts.forEach((item, i) => {
        if (item.text.match(/^\d{1,2}\/\d{1,2}\s*\(/) || 
            item.text.match(/^\d{2}:00$/) ||
            item.text.match(/^(상급|중급|초급)$/) ||
            item.text.match(/^\d+\/\d+$/)) {
          console.log(`[${i}] ${item.text}`);
        }
      });
      
      return results;
    }, CONFIG);
    
    console.log(`추출된 티켓 (${CONFIG.TARGET_LEVELS.join(', ')} 레벨):`, ticketData);
    console.log(`총 ${ticketData.length}개 티켓 발견`);
    
    // 타겟 날짜 필터링 - 디버깅을 위해 상세 로그 추가
    console.log('타겟 날짜:', CONFIG.TARGET_DATES);
    console.log('필터링 전 티켓 수:', ticketData.length);
    
    const filteredTickets = ticketData.filter(ticket => {
      const isTargetDate = CONFIG.TARGET_DATES.includes(ticket.date);
      if (!isTargetDate && CONFIG.DEBUG) {
        console.log(`필터링됨: ${ticket.date} ${ticket.time} (타겟 날짜 아님)`);
      }
      return isTargetDate;
    });
    
    console.log('필터링 후 티켓 수:', filteredTickets.length);
    
    // 최종 필터링 로직 개선
    let finalTickets = [];
    
    if (CONFIG.INCLUDE_ALL_DATES) {
      // 모든 날짜 포함
      finalTickets = ticketData;
      console.log('모든 날짜의 티켓 포함');
    } else {
      // 타겟 날짜만 필터링
      finalTickets = ticketData.filter(ticket => {
        const isTargetDate = CONFIG.TARGET_DATES.includes(ticket.date);
        if (!isTargetDate && CONFIG.DEBUG) {
          console.log(`필터링됨: ${ticket.date} ${ticket.time} (타겟 날짜 아님)`);
        }
        return isTargetDate;
      });
    }
    
    // 이전 상태 로드
    let previousState = {};
    try {
      const stateData = await fs.readFile('state.json', 'utf8');
      previousState = JSON.parse(stateData);
    } catch (e) {
      console.log('이전 상태 없음, 새로 시작');
    }
    
    // 새로운 티켓 찾기
    const newTickets = [];
    finalTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      
      // 이전 상태와 비교
      if (!previousState[key]) {
        // 완전히 새로운 티켓
        newTickets.push(ticket);
        console.log(`✅ 새 티켓: ${ticket.date} ${ticket.time} - ${ticket.raw}`);
      } else if (previousState[key].totalSeats < ticket.totalSeats) {
        // 좌석이 늘어난 경우
        newTickets.push(ticket);
        console.log(`📈 좌석 증가: ${ticket.date} ${ticket.time} - ${previousState[key].totalSeats} -> ${ticket.totalSeats}`);
      }
    });
    
    // 알림 발송
    if (newTickets.length > 0) {
      console.log(`\n🎯 새로운 티켓 ${newTickets.length}개 발견!`);
      
      // 레벨별로 그룹화하여 출력
      const ticketsByLevel = {};
      newTickets.forEach(ticket => {
        if (!ticketsByLevel[ticket.level]) {
          ticketsByLevel[ticket.level] = [];
        }
        ticketsByLevel[ticket.level].push(ticket);
      });
      
      Object.keys(ticketsByLevel).forEach(level => {
        console.log(`\n[${level}]`);
        ticketsByLevel[level].forEach(t => {
          console.log(`  - ${t.date} ${t.time}: 좌 ${t.leftSeats} / 우 ${t.rightSeats}`);
        });
      });
      
      await sendNotifications(newTickets);
    } else {
      console.log(`\n😔 새로운 ${CONFIG.TARGET_LEVELS.join('/')} 티켓 없음`);
      if (finalTickets.length > 0) {
        console.log(`(기존 티켓 ${finalTickets.length}개는 이미 알림 발송됨)`);
      }
    }
    
    // 상태 저장
    const newState = {};
    finalTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      newState[key] = {
        ...ticket,
        savedAt: new Date().toISOString()
      };
    });
    await fs.writeFile('state.json', JSON.stringify(newState, null, 2));
    console.log('상태 저장 완료');
    
    return finalTickets;
    
  } catch (error) {
    console.error('스크래핑 에러:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ===== 알림 발송 함수 =====
async function sendNotifications(tickets) {
  // 1. Telegram 알림
  // if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
  //   const message = formatTelegramMessage(tickets);
    
  //   try {
  //     const response = await fetch(
  //       `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
  //       {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({
  //           chat_id: CONFIG.TELEGRAM_CHAT_ID,
  //           text: message,
  //           parse_mode: 'HTML'
  //         })
  //       }
  //     );
      
  //     if (response.ok) {
  //       console.log('✅ Telegram 알림 발송 성공');
  //     }
  //   } catch (error) {
  //     console.error('Telegram 알림 실패:', error);
  //   }
  // }
  
  // 2. Webhook (Google Apps Script) 알림
  if (CONFIG.WEBHOOK_URL) {
    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets })
      });
      
      if (response.ok) {
        console.log('✅ Webhook 알림 발송 성공');
      }
    } catch (error) {
      console.error('Webhook 알림 실패:', error);
    }
  }
}

// ===== 메시지 포맷팅 =====
function formatTelegramMessage(tickets) {
  let message = '🏄 <b>웨이브파크 티켓 예매 가능!</b>\n\n';
  
  // 레벨별로 그룹화
  const ticketsByLevel = {};
  tickets.forEach(ticket => {
    if (!ticketsByLevel[ticket.level]) {
      ticketsByLevel[ticket.level] = [];
    }
    ticketsByLevel[ticket.level].push(ticket);
  });
  
  // 레벨별로 메시지 작성
  Object.keys(ticketsByLevel).forEach(level => {
    message += `<b>[${level}]</b>\n`;
    ticketsByLevel[level].forEach(ticket => {
      message += `📅 ${ticket.date} ${ticket.time}\n`;
      message += `🎫 좌측 ${ticket.leftSeats} / 우측 ${ticket.rightSeats}\n`;
      message += `━━━━━━━━━━━━━━\n`;
    });
  });
  
  message += `\n🔗 <a href="https://www.wavepark.co.kr/">지금 바로 예매하기</a>`;
  
  return message;
}

// ===== 실행 =====
if (require.main === module) {
  scrapeWavePark()
    .then(() => {
      console.log('스크래핑 완료');
      process.exit(0);
    })
    .catch(error => {
      console.error('스크래핑 실패:', error);
      process.exit(1);
    });
}

module.exports = { scrapeWavePark };

// ===== package.json =====
/*
{
  "name": "wavepark-scraper",
  "version": "1.0.0",
  "main": "scraper.js",
  "scripts": {
    "start": "node scraper.js",
    "test": "node scraper.js"
  },
  "dependencies": {
    "puppeteer": "^21.0.0"
  }
}
*/

// ===== Docker 실행 (선택사항) =====
/*
FROM node:18-slim

# Chrome 의존성 설치
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

CMD ["node", "scraper.js"]
*/
