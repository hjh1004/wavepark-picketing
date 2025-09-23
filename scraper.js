// ========================================
// 웨이브파크 Puppeteer 스크래퍼
// Headless 브라우저로 렌더링된 DOM 파싱
// ========================================

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// ===== 설정 =====
const CONFIG = {
  URL: 'https://wavepark.framer.website/',
  TARGET_DATES: ['2024-09-27', '2024-09-28'],
  DEBUG: true,
  WEBHOOK_URL: process.env.WEBHOOK_URL || '', // Google Apps Script Web App URL
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

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
    
    console.log('페이지 로딩 중...');
    
    // 페이지 이동
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 추가 대기 (동적 콘텐츠 로딩)
    await page.waitForTimeout(5000);
    
    // 잔여좌우 요소가 로드될 때까지 대기
    try {
      await page.waitForSelector('[data-framer-name="잔여좌우"]', {
        timeout: 10000
      });
      console.log('잔여좌우 요소 발견!');
    } catch (e) {
      console.log('잔여좌우 요소를 찾을 수 없습니다. 계속 진행...');
    }
    
    // DOM에서 데이터 추출
    const ticketData = await page.evaluate(() => {
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
      
      for (let i = 0; i < allTexts.length; i++) {
        const item = allTexts[i];
        const text = item.text;
        
        // 날짜 패턴: "9/27 (토)"
        if (text.match(/^\d{1,2}\/\d{1,2}\s*\([월화수목금토일]\)$/)) {
          const match = text.match(/(\d{1,2})\/(\d{1,2})/);
          if (match) {
            currentDate = `2024-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
          }
        }
        // 시간 패턴: "10:00"
        else if (text.match(/^\d{2}:00$/)) {
          currentTime = text;
        }
        // 레벨 패턴
        else if (text === '상급' || text === '중급' || text === '초급') {
          currentLevel = text;
          
          // 배경색 확인 (더 정확한 레벨 판단)
          const parent = item.element.closest('div[style*="background-color"]');
          if (parent) {
            const style = parent.getAttribute('style');
            if (style && style.includes('rgb(239, 68, 68)')) {
              currentLevel = '상급';
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
            
            // 상급만 저장
            if (currentLevel === '상급' && (leftSeats + rightSeats) > 0) {
              results.push({
                date: currentDate,
                time: currentTime,
                level: currentLevel,
                leftSeats: leftSeats,
                rightSeats: rightSeats,
                totalSeats: leftSeats + rightSeats,
                raw: text
              });
            }
          }
        }
      }
      
      // 추가 방법: 직접 선택자로 찾기
      const seatDivs = document.querySelectorAll('[data-framer-name="잔여좌우"]');
      console.log(`잔여좌우 요소 ${seatDivs.length}개 발견`);
      
      seatDivs.forEach(div => {
        const text = div.textContent.trim();
        console.log(`잔여좌우 텍스트: ${text}`);
      });
      
      return results;
    });
    
    console.log('추출된 상급 티켓:', ticketData);
    
    // 타겟 날짜 필터링
    const filteredTickets = ticketData.filter(ticket => 
      CONFIG.TARGET_DATES.includes(ticket.date)
    );
    
    // 스크린샷 저장 (디버깅용)
    if (CONFIG.DEBUG) {
      await page.screenshot({ 
        path: 'wavepark_screenshot.png',
        fullPage: true 
      });
      console.log('스크린샷 저장 완료: wavepark_screenshot.png');
      
      // HTML 저장
      const html = await page.content();
      await fs.writeFile('wavepark_dom.html', html);
      console.log('HTML 저장 완료: wavepark_dom.html');
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
    filteredTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      if (!previousState[key] || previousState[key].totalSeats < ticket.totalSeats) {
        newTickets.push(ticket);
      }
    });
    
    // 알림 발송
    if (newTickets.length > 0) {
      console.log(`🎯 새로운 상급 티켓 ${newTickets.length}개 발견!`);
      await sendNotifications(newTickets);
    } else {
      console.log('새로운 상급 티켓 없음');
    }
    
    // 상태 저장
    const newState = {};
    filteredTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      newState[key] = ticket;
    });
    await fs.writeFile('state.json', JSON.stringify(newState, null, 2));
    
    return filteredTickets;
    
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
  if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
    const message = formatTelegramMessage(tickets);
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CONFIG.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
          })
        }
      );
      
      if (response.ok) {
        console.log('✅ Telegram 알림 발송 성공');
      }
    } catch (error) {
      console.error('Telegram 알림 실패:', error);
    }
  }
  
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
  let message = '🏄 <b>웨이브파크 상급 티켓 예매 가능!</b>\n\n';
  
  tickets.forEach(ticket => {
    message += `📅 날짜: ${ticket.date}\n`;
    message += `⏰ 시간: ${ticket.time}\n`;
    message += `🎫 잔여: 좌측 ${ticket.leftSeats} / 우측 ${ticket.rightSeats}\n`;
    message += `━━━━━━━━━━━━━━\n`;
  });
  
  message += `\n🔗 <a href="${CONFIG.URL}">지금 바로 예매하기</a>`;
  
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

// ===== GitHub Actions 실행 (선택사항) =====
// /*
// name: WavePark Scraper

// on:
//   schedule:
//     - cron: '*/10 * * * *'
//   workflow_dispatch:

// jobs:
//   scrape:
//     runs-on: ubuntu-latest
//     steps:
//     - uses: actions/checkout@v3
//     - uses: actions/setup-node@v3
//       with:
//         node-version: '18'
//     - run: npm ci
//     - run: npm start
//       env:
//         TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
//         TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
// */