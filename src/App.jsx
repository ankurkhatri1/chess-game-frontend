import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import SimplePeer from 'simple-peer';
import './App.css';

const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],
});

function App() {
  const [game, setGame] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const [role, setRole] = useState(null);
  const [color, setColor] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTurn, setCurrentTurn] = useState('white');

  // Chess Logic
  useEffect(() => {
    socket.on('move', ({ san, fen }) => {
      const newGame = new Chess(fen); // Update local game state from server
      setGame(newGame);
      setPosition(fen);
    });

    socket.on('role', ({ role, color }) => {
      console.log(`Assigned role: ${role}, color: ${color}`);
      setRole(role);
      setColor(color);
    });

    socket.on('start', ({ turn, fen }) => {
      console.log('Game started, turn:', turn);
      setIsConnected(true);
      setCurrentTurn(turn);
      setPosition(fen);
      setGame(new Chess(fen));
    });

    socket.on('turn', (turn) => {
      console.log('Current turn:', turn);
      setCurrentTurn(turn);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      alert(err);
    });

    return () => {
      socket.off('move');
      socket.off('role');
      socket.off('start');
      socket.off('turn');
      socket.off('error');
    };
  }, []);

  // WebRTC Logic
  useEffect(() => {
    if (!role || !isConnected) return;

    let localStream;
    let peerInstance;

    const initPeer = async () => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.muted = true;
          await localVideoRef.current.play();
        }

        peerInstance = new SimplePeer({
          initiator: role === 'initiator',
          trickle: true,
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
              {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh',
              },
              {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
            ],
          },
        });

        peerInstance.on('signal', (data) => {
          console.log('SIGNAL:', data.type || 'candidate');
          socket.emit('signal', data);
        });

        peerInstance.on('stream', (remoteStream) => {
          console.log('GOT REMOTE STREAM');
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.play().catch((e) => console.log('Video play error:', e));
          }
        });

        peerInstance.on('error', (err) => {
          console.error('PEER ERROR:', err);
        });

        peerInstance.on('connect', () => {
          console.log('WEBRTC CONNECTED!');
        });

        peerRef.current = peerInstance;

        socket.on('signal', (data) => {
          console.log('RECEIVED SIGNAL:', data.type || 'candidate');
          if (!peerInstance.destroyed) {
            peerInstance.signal(data);
          }
        });
      } catch (err) {
        console.error('Media error:', err);
      }
    };

    initPeer();

    return () => {
      if (peerInstance) {
        console.log('CLEANING UP PEER');
        peerInstance.destroy();
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      socket.off('signal');
    };
  }, [role, isConnected]);

  // Handle Chess Moves
  const onDrop = (sourceSquare, targetSquare) => {
    if (color !== currentTurn) {
      alert('TERI BAARI NAHI HAI, BHAI! DUSHMAN KA WAIT KAR!');
      return false;
    }

    const newGame = new Chess(game.fen()); // Clone current game state
    const move = newGame.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q',
    });

    if (move === null) {
      alert('GALAT CHAL, BHAI! SOCH KE KHEL!');
      return false;
    }

    // Locally update the board immediately
    setGame(newGame);
    setPosition(newGame.fen());
    socket.emit('move', move.san); // Send move to server
    return true;
  };

  return (
    <div className="App">
      <h1>CHESS WITH VIDEO CALL, LADAI SHURU!</h1>
      <div className="game-container">
        <Chessboard
          position={position}
          onPieceDrop={onDrop}
          boardWidth={500}
          customBoardStyle={{
            borderRadius: '4px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
          }}
        />
        <div className="video-container">
          <div className="video-box">
            <video ref={localVideoRef} autoPlay playsInline className="video-self" />
            <div className="video-label">TU ({color || 'Wait'})</div>
          </div>
          <div className="video-box">
            <video ref={remoteVideoRef} autoPlay playsInline className="video-peer" />
            <div className="video-label">DUSHMAN</div>
          </div>
        </div>
      </div>
      <div className="status">
        {role && `TU ${role.toUpperCase()} HAI, COLOR: ${color?.toUpperCase()}`} <br />
        {isConnected ? `CONNECTED! AB ${currentTurn.toUpperCase()} KI BAARI!` : 'DUSHMAN KA WAIT KAR...'}
      </div>
    </div>
  );
}

export default App;