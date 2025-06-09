const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const retry = require('async-retry');

// ... [as before, up to and including the ffmpeg.setFfmpegPath line]

const app = express();
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

app.use(express.json());

// Initialize p-queue dynamically to handle ESM
let queue;
(async () => {
  const { default: PQueue } = await import('p-queue');
  queue = new PQueue({ concurrency: 1 });
})();

const publicDir = path.join(__dirname, 'public');
fs.ensureDirSync(publicDir);

app.get('/ping', (req, res) => {
  console.log('Recebido ping');
  res.send('Server is alive!');
});

// ... [keep all helper functions as in original code]

app.post('/generate-video', async (req, res) => {
  if (!queue) {
    return res.status(500).json({ error: 'Queue not initialized' });
  }
  queue.add(async () => {
    const tempDir = path.join(__dirname, 'temp');
    let outputPath = null;
    try {
      const { config, driveAccessToken, driveFolderId, callbackUrl } = req.body;
      if (!config || !config.outputFile || !driveAccessToken) {
        console.error('Configuração inválida ou parâmetros ausentes');
        return res.status(400).json({ error: 'Configuração inválida ou parâmetros ausentes' });
      }

      const usandoMediaUrls = Array.isArray(config.mediaUrls) && config.mediaUrls.length > 0;
      const usandoVideoSimples = config.videoUrl && config.audioUrl;

      if (!usandoMediaUrls && !usandoVideoSimples) {
        console.error('Nem mediaUrls nem videoUrl/audioUrl foram fornecidos.');
        return res.status(400).json({ error: 'Nenhum conteúdo de mídia fornecido.' });
      }

      await fs.ensureDir(tempDir);

      // Modo simples: videoUrl + audioUrl
      if (usandoVideoSimples) {
        console.log('Modo simples: combinando videoUrl + audioUrl');

        const videoPath = path.join(tempDir, 'video.mp4');
        const audioPath = path.join(tempDir, 'audio.mp3');
        outputPath = path.join(publicDir, config.outputFile);

        await downloadFile(config.videoUrl, videoPath);
        await downloadFile(config.audioUrl, audioPath);

        await new Promise((resolve, reject) => {
          const command = ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .videoCodec('copy')
            .audioCodec('aac')
            .outputOptions(['-shortest'])
            .output(outputPath)
            .on('start', (cmd) => console.log(`Comando FFmpeg (simples): ${cmd}`))
            .on('progress', (progress) => console.log(`Progresso FFmpeg (simples): ${progress.percent}%`))
            .on('end', resolve)
            .on('error', (err) => reject(new Error(`Erro no FFmpeg (simples): ${err.message}`)))
            .run();

          setTimeout(() => {
            command.kill('SIGKILL');
            reject(new Error('FFmpeg (simples) timed out after 180 seconds'));
          }, 180000);
        });

        console.log('Vídeo simples gerado:', outputPath);

        const driveFileId = await uploadToDrive(outputPath, driveAccessToken, driveFolderId);
        const driveFileUrl = `https://drive.google.com/file/d/${driveFileId}/view`;

        if (callbackUrl) {
          try {
            const response = await axios.post(callbackUrl, {
              configId: config.configId,
              driveFileId,
              driveFileUrl
            });
            console.log('Callback enviado. Resposta:', response.data);
          } catch (error) {
            console.error('Erro ao enviar callback:', error.message);
          }
        }

        await cleanupTempFiles(tempDir, outputPath);
        return res.json({ success: true, driveFileId, driveFileUrl });
      }

      // ... [retain and execute the original mediaUrls logic block here as in your original code]

    } catch (error) {
      console.error('Erro no generate-video:', error.message);
      await cleanupTempFiles(tempDir, outputPath);
      res.status(500).json({ error: error.message });
    }
  }).then(() => {}).catch(err => {
    console.error('Erro na fila:', err.message);
    res.status(500).json({ error: err.message });
  });
});

app.use('/public', express.static(publicDir));

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});
