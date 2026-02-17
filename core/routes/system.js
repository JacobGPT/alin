/**
 * System, Hardware & Blender endpoints
 * /api/system/metrics — real-time CPU, memory, GPU metrics
 * /api/hardware/gpu-compute — run CUDA/compute tasks
 * /api/hardware/gpu-info — detailed GPU information
 * /api/hardware/processes — GPU processes
 * /api/hardware/webcam — capture webcam frame
 * /api/blender/execute — run Blender Python scripts headlessly
 * /api/blender/render — render a .blend file headlessly
 */
import path from 'path';
import os from 'os';
import fsSync from 'node:fs';
import { execSync } from 'child_process';

/**
 * Auto-detect Blender executable on Windows.
 */
function findBlenderPath() {
  if (process.env.BLENDER_PATH) {
    if (fsSync.existsSync(process.env.BLENDER_PATH)) return process.env.BLENDER_PATH;
  }

  if (process.platform === 'win32') {
    const programDirs = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
    ];

    for (const progDir of programDirs) {
      try {
        const entries = fsSync.readdirSync(progDir);
        for (const entry of entries) {
          if (entry.toLowerCase().includes('blender')) {
            const blenderDir = path.join(progDir, entry);
            const directExe = path.join(blenderDir, 'blender.exe');
            if (fsSync.existsSync(directExe)) return directExe;
            try {
              const subEntries = fsSync.readdirSync(blenderDir);
              for (const sub of subEntries) {
                if (sub.toLowerCase().includes('blender')) {
                  const subExe = path.join(blenderDir, sub, 'blender.exe');
                  if (fsSync.existsSync(subExe)) return subExe;
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    const downloadsBlender = path.join(os.homedir(), 'Downloads', 'Blender 5.0');
    if (fsSync.existsSync(path.join(downloadsBlender, 'blender.exe'))) {
      return path.join(downloadsBlender, 'blender.exe');
    }
  }

  try {
    execSync(process.platform === 'win32' ? 'where blender' : 'which blender', { timeout: 5000, stdio: 'pipe' });
    return 'blender';
  } catch {}

  return null;
}

let _detectedBlenderPath = null;
function getBlenderPath() {
  if (_detectedBlenderPath === undefined) return null;
  if (_detectedBlenderPath !== null) return _detectedBlenderPath;
  _detectedBlenderPath = findBlenderPath();
  if (_detectedBlenderPath) {
    console.log(`[Blender] Found at: ${_detectedBlenderPath}`);
  } else {
    console.warn('[Blender] NOT FOUND — Blender features will be unavailable');
    _detectedBlenderPath = undefined;
  }
  return _detectedBlenderPath || null;
}

export function registerSystemRoutes(ctx) {
  const { app, requireAuth, ALLOWED_DIRS, isPathAllowed, rootDir } = ctx;

  /**
   * GET /api/system/metrics
   */
  app.get('/api/system/metrics', requireAuth, (req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const cpuUsage = ((1 - totalIdle / totalTick) * 100);

    let gpu = null;
    try {
      const nvResult = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits', { timeout: 2000 }).toString().trim();
      const parts = nvResult.split(', ');
      if (parts.length >= 4) {
        gpu = {
          name: parts[0],
          usage: parseFloat(parts[1]) || 0,
          memoryUsed: (parseFloat(parts[2]) || 0) * 1024 * 1024,
          memoryTotal: (parseFloat(parts[3]) || 0) * 1024 * 1024,
          temperature: parseFloat(parts[4]) || undefined,
          power: parseFloat(parts[5]) || undefined,
        };
      }
    } catch (e) {
      // No NVIDIA GPU or nvidia-smi not available
    }

    res.json({
      timestamp: Date.now(),
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        frequency: cpus[0]?.speed || 0,
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usagePercent: Math.round((usedMem / totalMem) * 10000) / 100,
      },
      gpu,
      uptime: os.uptime(),
      platform: os.platform(),
    });
  });

  /**
   * POST /api/hardware/gpu-compute
   */
  app.post('/api/hardware/gpu-compute', requireAuth, async (req, res) => {
    try {
      const { script, framework, timeout: timeoutMs } = req.body;
      if (!script) return res.status(400).json({ success: false, error: 'Script required' });

      const fw = framework || 'python';
      const maxTimeout = Math.min(timeoutMs || 120000, 300000);

      const tmpFile = path.join(os.tmpdir(), `alin_gpu_${Date.now()}.py`);
      fsSync.writeFileSync(tmpFile, script);

      const { execFile } = await import('child_process');
      const startTime = Date.now();

      execFile('python', [tmpFile], {
        timeout: maxTimeout,
        env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        try { fsSync.unlinkSync(tmpFile); } catch {}

        if (error) {
          return res.json({
            success: false,
            error: error.message,
            stderr: stderr?.toString() || '',
            stdout: stdout?.toString() || '',
            duration,
          });
        }

        res.json({
          success: true,
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || '',
          duration,
        });
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/hardware/gpu-info
   */
  app.get('/api/hardware/gpu-info', requireAuth, (req, res) => {
    try {
      const nvResult = execSync(
        'nvidia-smi --query-gpu=name,driver_version,pci.bus_id,utilization.gpu,utilization.memory,memory.used,memory.total,memory.free,temperature.gpu,temperature.memory,power.draw,power.limit,clocks.current.graphics,clocks.current.memory,clocks.max.graphics,clocks.max.memory --format=csv,noheader,nounits',
        { timeout: 3000 }
      ).toString().trim();

      const parts = nvResult.split(', ').map(s => s.trim());
      res.json({
        success: true,
        gpu: {
          name: parts[0],
          driverVersion: parts[1],
          pciBusId: parts[2],
          gpuUtilization: parseFloat(parts[3]) || 0,
          memoryUtilization: parseFloat(parts[4]) || 0,
          memoryUsed: (parseFloat(parts[5]) || 0) * 1024 * 1024,
          memoryTotal: (parseFloat(parts[6]) || 0) * 1024 * 1024,
          memoryFree: (parseFloat(parts[7]) || 0) * 1024 * 1024,
          temperature: parseFloat(parts[8]) || 0,
          memoryTemperature: parseFloat(parts[9]) || null,
          powerDraw: parseFloat(parts[10]) || 0,
          powerLimit: parseFloat(parts[11]) || 0,
          clockGraphics: parseFloat(parts[12]) || 0,
          clockMemory: parseFloat(parts[13]) || 0,
          maxClockGraphics: parseFloat(parts[14]) || 0,
          maxClockMemory: parseFloat(parts[15]) || 0,
        },
      });
    } catch (err) {
      res.json({ success: false, error: 'No NVIDIA GPU detected or nvidia-smi not available' });
    }
  });

  /**
   * GET /api/hardware/processes
   */
  app.get('/api/hardware/processes', requireAuth, (req, res) => {
    try {
      const result = execSync(
        'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits',
        { timeout: 3000 }
      ).toString().trim();

      const processes = result.split('\n').filter(Boolean).map(line => {
        const parts = line.split(', ').map(s => s.trim());
        return {
          pid: parseInt(parts[0]) || 0,
          name: parts[1] || 'unknown',
          memoryUsed: (parseFloat(parts[2]) || 0) * 1024 * 1024,
        };
      });

      res.json({ success: true, processes });
    } catch {
      res.json({ success: true, processes: [] });
    }
  });

  /**
   * POST /api/hardware/webcam
   */
  app.post('/api/hardware/webcam', requireAuth, async (req, res) => {
    try {
      const { device, width, height } = req.body;
      const deviceIdx = device || 0;
      const w = width || 640;
      const h = height || 480;

      const script = `
import cv2, base64, sys, json
cap = cv2.VideoCapture(${deviceIdx})
if not cap.isOpened():
    print(json.dumps({"error": "Cannot open camera"}))
    sys.exit(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, ${w})
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ${h})
ret, frame = cap.read()
cap.release()
if not ret:
    print(json.dumps({"error": "Failed to capture frame"}))
    sys.exit(0)
_, buffer = cv2.imencode('.jpg', frame)
b64 = base64.b64encode(buffer).decode('utf-8')
print(json.dumps({"image": b64, "width": frame.shape[1], "height": frame.shape[0]}))
`;
      const tmpFile = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.py`);
      fsSync.writeFileSync(tmpFile, script);

      const result = execSync(`python "${tmpFile}"`, { timeout: 10000 }).toString().trim();
      try { fsSync.unlinkSync(tmpFile); } catch {}

      const data = JSON.parse(result);
      if (data.error) {
        return res.json({ success: false, error: data.error });
      }
      res.json({ success: true, image: data.image, width: data.width, height: data.height });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/blender/execute
   */
  app.post('/api/blender/execute', requireAuth, async (req, res) => {
    try {
      const {
        script,
        blendFile,
        outputFormat,
        outputPath,
        autoRender,
        engine,
        frame,
        timeout: timeoutMs
      } = req.body;

      if (!script) return res.status(400).json({ success: false, error: 'script required' });

      const maxTimeout = Math.min(timeoutMs || 120000, 600000);
      const blenderPath = getBlenderPath();
      if (!blenderPath) {
        return res.status(500).json({
          success: false,
          error: 'BLENDER_NOT_FOUND: Blender is not installed or could not be located. Checked: Program Files, AppData, Downloads, and PATH. Install Blender from https://www.blender.org/download/ or set BLENDER_PATH environment variable to the full path of blender.exe',
        });
      }
      const format = (outputFormat || 'PNG').toUpperCase();
      const renderEngine = (engine || 'CYCLES').toUpperCase();
      const frameNum = Number.isFinite(frame) ? Number(frame) : 1;

      const tmpScript = path.join(os.tmpdir(), `alin_blender_${Date.now()}_${Math.random().toString(16).slice(2)}.py`);

      const blenderOutputDir = path.join(rootDir, 'output', 'blender');
      if (!fsSync.existsSync(blenderOutputDir)) {
        fsSync.mkdirSync(blenderOutputDir, { recursive: true });
      }

      const tmpOutputBase = outputPath
        ? path.resolve(outputPath)
        : path.join(blenderOutputDir, `render_${Date.now()}`);

      const isBlenderPathAllowed = (p) => {
        if (isPathAllowed(p)) return true;
        const rp = path.resolve(p);
        return rp.startsWith(path.resolve(os.tmpdir()));
      };

      let resolvedBlendPath = null;
      if (blendFile) {
        resolvedBlendPath = path.resolve(blendFile);
        if (!isPathAllowed(resolvedBlendPath)) {
          return res.status(403).json({ success: false, error: 'blendFile path not allowed' });
        }
        if (!fsSync.existsSync(resolvedBlendPath)) {
          return res.status(400).json({ success: false, error: 'blendFile does not exist' });
        }
      }

      if (outputPath && !isBlenderPathAllowed(tmpOutputBase)) {
        return res.status(403).json({ success: false, error: 'outputPath not allowed' });
      }

      const wrappedScript = `
import bpy, sys, json, os, traceback

ALIN_OUTPUT_BASE = r"""${tmpOutputBase.replace(/\\/g, '\\\\')}"""
ALIN_FORMAT = "${format}"
ALIN_ENGINE = "${renderEngine}"
ALIN_FRAME = ${frameNum}
ALIN_AUTORENDER = ${autoRender ? 'True' : 'False'}
alin_did_render = False

def alin_configure_render():
    try:
        scene = bpy.context.scene
        try:
            scene.render.engine = ALIN_ENGINE
        except:
            pass
        scene.render.image_settings.file_format = ALIN_FORMAT
        scene.render.filepath = ALIN_OUTPUT_BASE
        scene.render.use_file_extension = True
        try:
            scene.frame_set(ALIN_FRAME)
        except:
            pass
    except Exception as e:
        print("ALIN_RENDER_CONFIG_ERROR:" + str(e))

def alin_render(write_still=True):
    global alin_did_render
    alin_configure_render()
    try:
        bpy.ops.render.render(write_still=write_still)
        alin_did_render = True
    except Exception as e:
        print("ALIN_RENDER_ERROR:" + str(e))

${resolvedBlendPath ? '' : 'bpy.ops.wm.read_homefile(use_empty=True)\n'}

alin_configure_render()

# -------------------------
# USER SCRIPT START
# -------------------------
try:
${script.split('\n').map(line => '    ' + line).join('\n')}
except Exception:
    print("ALIN_USER_SCRIPT_ERROR:")
    traceback.print_exc()
# -------------------------
# USER SCRIPT END
# -------------------------

if ALIN_AUTORENDER and not alin_did_render:
    alin_render(write_still=True)

output_info = {
    "objects": len(bpy.data.objects),
    "meshes": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "scenes": len(bpy.data.scenes),
    "did_render": alin_did_render,
    "output_base": ALIN_OUTPUT_BASE,
    "format": ALIN_FORMAT,
}
print("ALIN_OUTPUT:" + json.dumps(output_info))
`;

      fsSync.writeFileSync(tmpScript, wrappedScript);

      const startTime = Date.now();
      const blendArg = resolvedBlendPath ? `"${resolvedBlendPath}"` : '';
      const cmd = `"${blenderPath}" --background ${blendArg} --python "${tmpScript}" 2>&1`;

      const result = execSync(cmd, { timeout: maxTimeout, maxBuffer: 10 * 1024 * 1024 }).toString();
      const duration = Date.now() - startTime;

      try { fsSync.unlinkSync(tmpScript); } catch {}

      const outputMatch = result.match(/ALIN_OUTPUT:(.+)/);
      const outputInfo = outputMatch ? JSON.parse(outputMatch[1]) : {};

      const ext = format.toLowerCase();
      const candidates = [
        `${tmpOutputBase}.${ext}`,
        `${tmpOutputBase}${String(frameNum).padStart(4, '0')}.${ext}`,
        `${tmpOutputBase}0001.${ext}`,
      ];

      let renderImage = null;
      let finalOutputPath = null;

      for (const p of candidates) {
        if (fsSync.existsSync(p)) {
          renderImage = fsSync.readFileSync(p).toString('base64');
          finalOutputPath = p;
          break;
        }
      }

      const hasScriptError = result.includes('ALIN_USER_SCRIPT_ERROR:') || result.includes('ALIN_RENDER_ERROR:');
      const didRender = outputInfo.did_render === true;
      const fileExists = finalOutputPath !== null;

      res.json({
        success: fileExists || (didRender && !hasScriptError),
        rendered: fileExists,
        output: result.slice(0, 50000),
        stdout: result.slice(0, 50000),
        duration,
        info: outputInfo,
        renderImage,
        renderFormat: format,
        outputPath: finalOutputPath || null,
        error: hasScriptError ? 'Blender script encountered errors — check output for details' : (!fileExists && autoRender ? 'Render completed but no output file was found' : undefined),
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message,
        hint: 'Ensure Blender is installed and accessible via PATH or BLENDER_PATH env variable',
      });
    }
  });

  /**
   * POST /api/blender/render
   */
  app.post('/api/blender/render', requireAuth, async (req, res) => {
    try {
      const { blendFile, frame, outputFormat, format, engine, outputPath } = req.body;
      if (!blendFile) return res.status(400).json({ success: false, error: 'blendFile required' });

      const resolvedPath = path.resolve(blendFile);
      const allowed = ALLOWED_DIRS.some(d => resolvedPath.startsWith(d));
      if (!allowed) return res.status(403).json({ success: false, error: 'Path not allowed' });
      if (!fsSync.existsSync(resolvedPath)) return res.status(400).json({ success: false, error: 'blendFile does not exist' });

      const blenderPath = getBlenderPath();
      if (!blenderPath) {
        return res.status(500).json({
          success: false,
          error: 'BLENDER_NOT_FOUND: Blender is not installed or could not be located. Install Blender from https://www.blender.org/download/ or set BLENDER_PATH environment variable.',
        });
      }

      const fmt = ((outputFormat || format) || 'PNG').toUpperCase();
      const renderEngine = (engine || 'CYCLES').toUpperCase();
      const frameNum = Number.isFinite(frame) ? Number(frame) : 1;

      const blenderOutputDir = path.join(rootDir, 'output', 'blender');
      if (!fsSync.existsSync(blenderOutputDir)) {
        fsSync.mkdirSync(blenderOutputDir, { recursive: true });
      }

      const tmpOutputBase = outputPath
        ? path.resolve(outputPath)
        : path.join(blenderOutputDir, `render_${Date.now()}`);

      const inAllowedDirs = ALLOWED_DIRS.some(d => tmpOutputBase.startsWith(d));
      const inTmp = tmpOutputBase.startsWith(path.resolve(os.tmpdir()));
      if (outputPath && !(inAllowedDirs || inTmp)) {
        return res.status(403).json({ success: false, error: 'outputPath not allowed' });
      }

      const startTime = Date.now();

      const cmd =
        `"${blenderPath}" --background "${resolvedPath}" ` +
        `--engine ${renderEngine} --render-output "${tmpOutputBase}" --render-format ${fmt} --render-frame ${frameNum} 2>&1`;

      const result = execSync(cmd, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }).toString();
      const duration = Date.now() - startTime;

      const ext = fmt.toLowerCase();
      const possibleFiles = [
        `${tmpOutputBase}${String(frameNum).padStart(4, '0')}.${ext}`,
        `${tmpOutputBase}.${ext}`,
      ];

      let renderImage = null;
      let finalOutputPath = null;

      for (const f of possibleFiles) {
        if (fsSync.existsSync(f)) {
          renderImage = fsSync.readFileSync(f).toString('base64');
          finalOutputPath = f;
          break;
        }
      }

      const fileExists = finalOutputPath !== null;

      res.json({
        success: fileExists,
        rendered: fileExists,
        output: result.slice(0, 20000),
        duration,
        renderImage,
        renderFormat: fmt,
        outputPath: finalOutputPath || null,
        error: !fileExists ? 'Render completed but no output file was produced — check Blender output for errors' : undefined,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message,
        hint: 'Ensure Blender is installed and the .blend file exists',
      });
    }
  });
}
