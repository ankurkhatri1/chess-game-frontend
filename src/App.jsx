import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import SimplePeer from 'simple-peer';
import './App.css';

const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000,
});

function App() {
  const [game, setGame] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const [role, setRole] = useState(null);
  const [color, setColor] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTurn, setCurrentTurn] = useState('white');
  const [error, setError] = useState('');

  // Socket Connection Status
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err);
      setError('Socket connection failed: ' + err.message);
      setIsConnected(false);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
    };
  }, []);

  // Chess Logic
  useEffect(() => {
    socket.on('move', ({ san, fen }) => {
      const newGame = new Chess(fen);
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
      setError(err);
    });

    return () => {
      socket.off('move');
      socket.off('role');
      socket.off('start');
      socket.off('turn');
      socket.off('error');
    };
  }, []);

  // WebRTC Logic (Only Audio)
  useEffect(() => {
    if (!role || !isConnected) return;

    let localStream;
    let peerInstance;

    const initPeer = async () => {
      try {
        console.log('Requesting audio stream...');
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });

        if (localAudioRef.current) {
          localAudioRef.current.srcObject = localStream;
          localAudioRef.current.muted = true;
          await localAudioRef.current.play().catch((e) => console.error('Local audio play error:', e));
          console.log('Local audio stream set');
        } else {
          setError('Local audio element not found!');
          return;
        }

        peerInstance = new SimplePeer({
          initiator: role === 'initiator',
          trickle: true,
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
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
          console.log('Sending signal:', data.type || 'candidate');
          socket.emit('signal', { data, to: role === 'initiator' ? 'receiver' : 'initiator' });
        });

        peerInstance.on('stream', (remoteStream) => {
          console.log('Received remote audio stream');
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.play().catch((e) => console.error('Remote audio play error:', e));
          } else {
            setError('Remote audio element not found!');
          }
        });

        peerInstance.on('error', (err) => {
          console.error('Peer error:', err);
          setError('Peer error: ' + err.message);
        });

        peerInstance.on('connect', () => {
          console.log('WebRTC audio connected!');
        });

        peerInstance.on('close', () => {
          console.log('Peer connection closed');
        });

        peerRef.current = peerInstance;

        socket.on('signal', ({ data, from }) => {
          console.log('Received signal from', from, ':', data.type || 'candidate');
          if (peerInstance && !peerInstance.destroyed) {
            peerInstance.signal(data);
          }
        });
      } catch (err) {
        console.error('Media error:', err);
        setError('Mic access denied or error: ' + err.message);
      }
    };

    initPeer();

    return () => {
      if (peerInstance) {
        console.log('Cleaning up peer');
        peerInstance.destroy();
        peerRef.current = null;
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

    const newGame = new Chess(game.fen());
    const move = newGame.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q',
    });

    if (move === null) {
      alert('GALAT CHAL, BHAI! SOCH KE KHEL!');
      return false;
    }

    setGame(newGame);
    setPosition(newGame.fen());
    socket.emit('move', move.san);
    return true;
  };

  return (
    <div className="App">
      <h1>CHESS WITH VOICE CALL, LADAI SHURU!</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!isConnected && <p style={{ color: 'red' }}>Connecting to server...</p>}
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
        <div className="audio-container">
          <div className="audio-box">
            <audio ref={localAudioRef} autoPlay playsInline />
            <div className="audio-label">TU ({color || 'Wait'})</div>
          </div>
          <div className="audio-box">
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <div className="audio-label">DUSHMAN</div>
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
