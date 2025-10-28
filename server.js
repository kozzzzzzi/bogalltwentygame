const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// 프론트에서 접근 허용할 도메인들
const ALLOWED_ORIGINS = [
  "https://oopp.kr",
  "http://oopp.kr",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.use(cors({
  origin: function (origin, callback) {
    // Render의 헬스체크나 같은-origin 호출은 origin이 빈값일 수도 있다.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS blocked: " + origin));
    }
  }
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

/*
rooms[roomCode] = {
  word: null,
  wordLocked: false,
  hostId: "socketId",
  hostName: "닉",
  guessers: [ {id, name}, ... ],
  chat: [],
  lastQuestionId: 0,
  questionCount: 0,
  waitingForAnswer: 0 | null,
  gameOver: false,
  gameResultForHost: null,      // "hostWin" | "hostLose"
  gameResultForGuesser: null,   // "guesserWin" | "guesserLose"
  finalWordShown: false
};
*/
const rooms = {};

// ====== 게임 종료 유틸 ======
function endGameGuesserLose(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostWin";
  room.gameResultForGuesser = "guesserLose";
  room.finalWordShown = true;
}

function endGameGuesserWin(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostLose";
  room.gameResultForGuesser = "guesserWin";
  room.finalWordShown = true;
}

function cleanupRoom(roomCode) {
  delete rooms[roomCode];
}

// ====== 새로 추가: 방 참가자 목록 브로드캐스트 ======
function emitPlayers(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("playersUpdate", {
    hostId: room.hostId,
    hostName: room.hostName,
    guessers: room.guessers || []
  });
}

// ====== 새로 추가: 방의 전체 상태(채팅/질문수 등) 브로드캐스트 ======
function emitRoomChatState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("chatUpdate", {
    items: room.chat,
    questionCount: room.questionCount,
    waitingForAnswer: room.waitingForAnswer,
    wordLocked: room.wordLocked,
    gameOver: room.gameOver,
    gameResultForHost: room.gameResultForHost,
    gameResultForGuesser: room.gameResultForGuesser,
    finalWord: room.finalWordShown ? room.word : undefined
  });
}

io.on("connection", (socket) => {

  // 출제자: 방 만들기
  socket.on("createRoom", ({ roomCode, nickname }) => {
    if (!roomCode) {
      socket.emit("errorMsg", "방 코드를 입력하세요.");
      return;
    }
    if (rooms[roomCode]) {
      socket.emit("errorMsg", "이미 존재하는 방 코드입니다.");
      return;
    }

    rooms[roomCode] = {
      word: null,
      wordLocked: false,
      hostId: socket.id,
      hostName: nickname || "출제자",
      guessers: [],

      chat: [],
      lastQuestionId: 0,
      questionCount: 0,
      waitingForAnswer: null,

      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWordShown: false
    };

    socket.join(roomCode);

    socket.emit("roomJoined", {
      role: "host",
      roomCode,
      word: null,
      wordLocked: false,
      questionCount: 0,
      waitingForAnswer: null,
      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWord: undefined
    });

    // 새로 추가: 참가자 목록/상태 브로드캐스트
    emitPlayers(roomCode);
    emitRoomChatState(roomCode);
  });

  // 참가자(정답자들): 방 참여 (여러 명 허용)
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMsg", "존재하지 않는 방 코드입니다.");
      return;
    }

    socket.join(roomCode);

    if (!room.guessers.find((g) => g.id === socket.id)) {
      room.guessers.push({
        id: socket.id,
        name: nickname || "참가자"
      });
    }

    socket.emit("roomJoined", {
      role: socket.id === room.hostId ? "host" : "guesser",
      roomCode,
      word: socket.id === room.hostId ? room.word : undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 전체에 현재 채팅/상태를 쏴줌
    emitRoomChatState(roomCode);

    // 새로 추가: 참가자 목록 브로드캐스트
    emitPlayers(roomCode);
  });

  // 출제자: 단어 설정 (1번만)
  socket.on("setWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.wordLocked) return;
    if (!word || !word.trim()) return;

    room.word = word.trim();
    room.wordLocked = true;

    // 모두에게 상태 전송 (단, 단어 자체는 안 보여줌)
    io.to(roomCode).emit("roomState", {
      role: null,
      roomCode,
      word: undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 출제자한테만 정답 단어 포함해서 다시 전송
    io.to(room.hostId).emit("roomState", {
      role: "host",
      roomCode,
      word: room.word,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  // 출제자: 힌트 보내기
  socket.on("sendHint", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!text || !text.trim()) return;
    if (room.gameOver) return;

    const hintMsg = {
      type: "hint",
      from: room.hostName || "출제자",
      text: text.trim()
    };
    room.chat.push(hintMsg);

    // 클라이언트 쪽은 newHint를 듣고 채팅 추가할 수 있음
    io.to(roomCode).emit("newHint", hintMsg);

    // 채팅 전체 상태도 갱신해서 보내주자
    emitRoomChatState(roomCode);
  });

  // 참가자: 질문
  socket.on("askQuestion", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.gameOver) return;
    if (!text || !text.trim()) return;

    if (socket.id === room.hostId) return;            // 출제자는 질문 불가
    if (!room.wordLocked || !room.word) return;       // 단어 미설정이면 불가
    if (room.waitingForAnswer) return;                // 이전 질문 답변 대기중이면 불가

    room.lastQuestionId += 1;
    room.questionCount += 1;

    let askerName = nickname;
    if (!askerName) {
      const g = room.guessers.find((gg) => gg.id === socket.id);
      askerName = g ? g.name : "참가자";
    }

    const q = {
      type: "q",
      id: room.lastQuestionId,
      from: askerName,
      text: text.trim()
    };

    room.chat.push(q);
    room.waitingForAnswer = q.id;

    io.to(roomCode).emit("newQuestion", {
      ...q,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 채팅 전체 상태도 갱신
    emitRoomChatState(roomCode);
  });

  // 출제자: 답변
  socket.on("answerQuestion", ({ roomCode, questionId, kind }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameOver) return;
    if (room.waitingForAnswer !== questionId) return;

    const a = {
      type: "a",
      qid: questionId,
      from: room.hostName || "출제자",
      kind // "yes" | "no" | "idk" | "correct"
    };
    room.chat.push(a);

    if (kind === "correct") {
      // 참가자 승리 (출제자 패배)
      endGameGuesserWin(room);

      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: null,
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      // 게임 종료 후 방 삭제
      cleanupRoom(roomCode);
      return;
    }

    // 정답이 아니면 다음 질문 가능
    room.waitingForAnswer = null;

    // 질문을 이미 20개 썼으면 여기서 참가자 패배 확정
    if (room.questionCount >= 20) {
      endGameGuesserLose(room);

      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: room.waitingForAnswer, // null
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      cleanupRoom(roomCode);
      return;
    }

    // 아직 안 끝났으면 그냥 답만 뿌리기
    io.to(roomCode).emit("newAnswer", {
      ...a,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 채팅 전체 상태도 갱신
    emitRoomChatState(roomCode);
  });


  // ====== 새로 추가: 출제자가 참가자 강퇴 ======
  // payload: { roomCode, playerId }
  socket.on("kickPlayer", ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // 권한 체크: 이 요청을 보낸 소켓이 방의 host여야만 함
    if (socket.id !== room.hostId) {
      return;
    }

    // 호스트 자신은 강퇴 불가
    if (playerId === room.hostId) return;

    const idx = room.guessers.findIndex((g) => g.id === playerId);
    if (idx === -1) {
      return;
    }

    // 참가자 목록에서 제거
    const [removed] = room.guessers.splice(idx, 1);

    // 강퇴 대상 소켓 찾아서 알림
    const kickedSocket = io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(roomCode);
      kickedSocket.emit("kicked", { reason: "host_kick" });
      // 완전 연결 강제로 끊고 싶으면 아래 주석 해제
      // kickedSocket.disconnect(true);
    }

    // 시스템 메시지로 채팅 로그에 남겨도 됨
    room.chat.push({
      type: "system",
      from: "[SYSTEM]",
      text: `${removed.name || "참가자"} 님이 강퇴되었습니다.`
    });

    // 인원 목록과 채팅상태 다시 방송
    emitPlayers(roomCode);
    emitRoomChatState(roomCode);
  });


  // ====== 연결 해제 처리 ======
  socket.on("disconnect", () => {
    // 1) 방장(출제자)였던 방 정리
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (!room) continue;

      if (room.hostId === socket.id) {
        // 방장 나갔으므로 방 안에 남아 있는 참가자들에게 알림
        io.to(roomCode).emit("roomClosed");

        // 방 삭제
        cleanupRoom(roomCode);
        continue;
      }

      // 2) 참가자였던 방 정리
      const idx = room.guessers.findIndex((g) => g.id === socket.id);
      if (idx !== -1) {
        const [leaver] = room.guessers.splice(idx, 1);

        // 시스템 메시지 추가
        room.chat.push({
          type: "system",
          from: "[SYSTEM]",
          text: `${leaver.name || "참가자"} 님이 나갔습니다.`
        });

        // 남아있는 사람들에게 최신 상태 전송
        emitPlayers(roomCode);
        emitRoomChatState(roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
