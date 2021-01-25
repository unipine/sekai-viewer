import React, {
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Marvin, MarvinImage, MarvinSegment } from "marvinj-ts";
import { useInteractiveStyles } from "../../../styles/interactive";
import {
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  Input,
  Snackbar,
  Switch,
  Tooltip,
  Typography,
} from "@material-ui/core";
import { Upload } from "mdi-material-ui";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { ColDef, DataGrid, RowModel } from "@material-ui/data-grid";
import { createWorker, createScheduler } from "tesseract.js";
import { useCachedData } from "../../../utils";
import { ICardInfo } from "../../../types";
import { Link } from "react-router-dom";
import { UserContext } from "../../../context";
import { useStrapi } from "../../../utils/apiClient";
import { Alert } from "@material-ui/lab";

function initCOS(N: number = 64) {
  const entries = 2 * N * (N - 1);
  const COS = new Float64Array(entries);
  for (let i = 0; i < entries; i++) {
    COS[i] = Math.cos((i / (2 * N)) * Math.PI);
  }
  return COS;
}

const COS = initCOS(32);

function hash(data: Uint8ClampedArray, N: number = 64) {
  const greyScale = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const index = 4 * (N * i + j);
      greyScale[N * i + j] =
        0.299 * data[index + 0] +
        0.587 * data[index + 1] +
        0.114 * data[index + 2];
    }
  }
  const dct = applyDCT2(greyScale, N);
  const output = [];
  for (let x = 1; x <= 8; x++) {
    for (let y = 1; y <= 8; y++) {
      output.push(dct[32 * x + y]);
    }
  }
  const median = output.slice().sort((a, b) => a - b)[
    Math.floor(output.length / 2)
  ];
  for (let i = 0; i < output.length; i++) {
    output[i] = output[i] > median ? 1 : 0;
  }
  return output;
}

function applyDCT2(f: Float64Array, N: number = 64) {
  const c = new Float64Array(N);
  for (let i = 1; i < N; i++) c[i] = 1;
  c[0] = 1 / Math.sqrt(2);
  const F = new Float64Array(N * N);
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          sum += COS[(2 * i + 1) * u] * COS[(2 * j + 1) * v] * f[N * i + j];
        }
      }
      sum *= (c[u] * c[v]) / 4;
      F[N * u + v] = sum;
    }
  }
  return F;
}

function distance(a: string, b: string) {
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      count++;
    }
  }
  return count;
}

const SekaiUserImportMember = () => {
  // const layoutClasses = useLayoutStyles();
  const interactiveClasses = useInteractiveStyles();
  const { t } = useTranslation();
  const { jwtToken, sekaiProfile, updateSekaiProfile } = useContext(
    UserContext
  )!;
  const { postSekaiCardList } = useStrapi(jwtToken);

  const [cards] = useCachedData<ICardInfo>("cards");

  const [isUploading, setIsUploading] = useState(false);
  const [rows, setRows] = useState<
    (RowModel & {
      crop: string;
      full: string[];
      hashResults: [string, number][];
      distances: number[];
      level: number;
      masterRank: number;
      cardIds: number[];
      useIndex: number;
    })[]
  >([]);
  const [ocrEnable, setOcrEnabled] = useState(false);
  const [postingCardList, setPostingCardList] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // const canvasRef = useRef<HTMLCanvasElement>(null);

  const onReaderLoad = useCallback(
    (e: ProgressEvent<FileReader>) => {
      if (!e.target) return;
      const dataUrl = e.target.result;
      if (!dataUrl) return;

      if (typeof dataUrl === "string") {
        // load dataUrl into MarvinImage
        const original = new MarvinImage();
        setIsUploading(true);
        original.load(dataUrl, async () => {
          setRows([]);
          // if (!canvasRef.current) return;
          // const context = canvasRef.current.getContext("2d");

          // const factor = original.getWidth() / 640;
          // const factor = 1;
          let scaled = original.clone();
          Marvin.grayScale(original, scaled);
          // Marvin.scale(
          //   original,
          //   scaled,
          //   Math.floor(original.getWidth() / factor),
          //   Math.floor(original.getHeight() / factor)
          // );

          // const grayscale = scaled.clone();
          // Marvin.grayScale(scaled, grayscale);

          // scan card area, expect white pixels more than 80% in one line
          let areaBoundary = new MarvinSegment(-1, -1, -1, -1);

          // horizontal scan
          const Xthreshold = 0.75;
          for (let y = 0; y < scaled.getHeight(); y++) {
            let whitePixels = 0;
            for (let x = 0; x < scaled.getWidth(); x++) {
              if (scaled.getIntColor(x, y) === 0xffffffff) whitePixels++;
            }
            if (whitePixels / scaled.getWidth() >= Xthreshold) {
              // found
              areaBoundary.y1 = y;
              break;
            }
          }
          for (let y = scaled.getHeight(); y > 0; y--) {
            let whitePixels = 0;
            for (let x = scaled.getWidth(); x > 0; x--) {
              if (scaled.getIntColor(x, y) === 0xffffffff) whitePixels++;
            }
            if (whitePixels / scaled.getWidth() >= Xthreshold) {
              // found
              areaBoundary.y2 = y;
              break;
            }
          }
          areaBoundary.height = areaBoundary.y2 - areaBoundary.y1;
          // vertical scan
          const Ythreshold = 0.95;
          for (let x = 0; x < scaled.getWidth(); x++) {
            let whitePixels = 0;
            for (let y = areaBoundary.y1; y < areaBoundary.y2; y++) {
              if (scaled.getIntColor(x, y) === 0xffffffff) whitePixels++;
            }
            if (whitePixels / areaBoundary.height >= Ythreshold) {
              // found
              areaBoundary.x1 = x;
              break;
            }
          }
          for (let x = scaled.getWidth(); x > 0; x--) {
            let whitePixels = 0;
            for (let y = areaBoundary.y2; y > areaBoundary.y1; y--) {
              if (scaled.getIntColor(x, y) === 0xffffffff) whitePixels++;
            }
            if (whitePixels / areaBoundary.height >= Ythreshold) {
              // found
              areaBoundary.x2 = x;
              break;
            }
          }
          areaBoundary.width = areaBoundary.x2 - areaBoundary.x1;
          // console.log(areaBoundary);

          // crop
          Marvin.crop(
            scaled.clone(),
            scaled,
            areaBoundary.x1,
            areaBoundary.y1,
            areaBoundary.width,
            areaBoundary.height
          );
          const originalCrop = original.clone();
          Marvin.crop(
            original,
            originalCrop,
            areaBoundary.x1,
            areaBoundary.y1,
            areaBoundary.width,
            areaBoundary.height
          );
          // binarize
          Marvin.blackAndWhite(scaled.clone(), scaled, 3);
          // canvasRef.current.style.width = `${original.getWidth()}px`;
          // canvasRef.current.style.height = `${original.getHeight()}px`;
          // canvasRef.current.style.height = `${
          //   canvasRef.current.clientWidth *
          //   (scaled.getHeight() / scaled.getWidth())
          // }px`;
          // canvasRef.current.width = scaled.getWidth() * window.devicePixelRatio;
          // canvasRef.current.height = scaled.getHeight() * window.devicePixelRatio;
          // context?.clearRect(
          //   0,
          //   0,
          //   canvasRef.current.width,
          //   canvasRef.current.height
          // );
          // scaled.draw(canvasRef.current, 0, 0, null);

          // find card boundaries
          // card icon are squares, background is white, easy to distinguish
          let avgHeight = 0;
          let columnStartX: number[] = [];
          let avgWidth = 0;
          let rowStartY: number[] = [];
          const colorCode = 0xffffffff;

          // determine right icon height
          for (let x = 0; x < scaled.getWidth(); x++) {
            let cardY: number[] = [];
            let heights: number[] = [];
            let inCardArea = false;
            for (let y = 0; y < scaled.getHeight(); y++) {
              // vertical scan until pixel is not white, push it to array
              if (scaled.getIntColor(x, y) < colorCode && !inCardArea) {
                cardY.push(y);
                inCardArea = true;
              } else if (scaled.getIntColor(x, y) >= colorCode && inCardArea) {
                cardY.push(y);
                inCardArea = false;
              }
              if (cardY.length === 2 && cardY[1] - cardY[0] > 30) {
                // first row not full, ignore
                Marvin.crop(
                  scaled.clone(),
                  scaled,
                  0,
                  cardY[1] + 20,
                  scaled.getWidth(),
                  scaled.getHeight()
                );
                Marvin.crop(
                  originalCrop.clone(),
                  originalCrop,
                  0,
                  cardY[1] + 20,
                  originalCrop.getWidth(),
                  originalCrop.getHeight()
                );
                cardY = [];
                y = 0;
                continue;
              }
              if (cardY.length === 4) {
                // cardY.forEach((y) => {
                //   context?.beginPath();
                //   context?.moveTo(0, y);
                //   context?.lineTo(original.getWidth(), y);
                //   context?.stroke();
                // });
                const height = cardY[1] - cardY[0] + cardY[3] - cardY[2];
                if (
                  heights.length &&
                  Math.abs(height - heights[heights.length - 1]) > 10
                )
                  continue;
                rowStartY.push(cardY[0]);
                heights.push(height);
                cardY = [];
              }
            }
            if (heights.length) {
              // console.log(heights);
              avgHeight = Math.round(
                heights.slice(1).reduce((sum, curr) => sum + curr, 0) /
                  (heights.length - 1)
              );
              // check first row
              // console.log(rowStartY);
              console.log(Math.abs(heights[0] - avgHeight));
              if (Math.abs(heights[0] - avgHeight) > 10) rowStartY.unshift();
              else if (Math.abs(heights[0] - avgHeight) >= 4)
                rowStartY[0] = rowStartY[0] - Math.abs(heights[0] - avgHeight);
              break;
            }
          }

          // determine right icon width
          for (let y = rowStartY[1] - 20; y < scaled.getHeight(); y++) {
            let cardX: number[] = [];
            let widths: number[] = [];
            let inCardArea = false;
            for (let x = 0; x < scaled.getWidth(); x++) {
              // horizontal scan until pixel is not white, push it to array
              if (scaled.getIntColor(x, y) < colorCode && !inCardArea) {
                cardX.push(x);
                inCardArea = true;
              } else if (scaled.getIntColor(x, y) >= colorCode && inCardArea) {
                cardX.push(x);
                inCardArea = false;
              }
              if (cardX.length === 4) {
                columnStartX.push(cardX[0]);
                const width = cardX[1] - cardX[0] + cardX[3] - cardX[2];
                widths.push(width);
                cardX = [];
              }
            }
            if (widths.length) {
              // console.log(widths);
              avgWidth = Math.round(
                widths.reduce((sum, curr) => sum + curr, 0) / widths.length
              );
              break;
            }
          }

          // console.log(avgWidth, avgHeight, columnStartX, rowStartY);

          // columnStartX.forEach((x) => {
          //   context?.beginPath();
          //   context?.moveTo(x, 0);
          //   context?.lineTo(x, scaled.getHeight());
          //   context?.stroke();

          //   context?.beginPath();
          //   context?.moveTo(x + avgWidth, 0);
          //   context?.lineTo(x + avgWidth, scaled.getHeight());
          //   context?.stroke();
          // });

          // rowStartY.forEach((y) => {
          //   context?.beginPath();
          //   context?.moveTo(0, y);
          //   context?.lineTo(scaled.getWidth(), y);
          //   context?.stroke();

          //   context?.beginPath();
          //   context?.moveTo(0, y + avgHeight);
          //   context?.lineTo(scaled.getWidth(), y + avgHeight);
          //   context?.stroke();
          // });

          // context?.strokeRect(
          //   areaBoundary.x1,
          //   areaBoundary.y1,
          //   areaBoundary.width,
          //   areaBoundary.height
          // );

          // card thumbnail segmentation
          const cardThumbnails: MarvinImage[] = [];
          const cardLevels: MarvinImage[] = [];
          const cardMasterRanks: MarvinImage[] = [];
          const cardHashes: string[] = [];
          const len = Math.max(avgWidth, avgHeight) + 4;
          columnStartX.forEach((x) => {
            rowStartY.forEach((y) => {
              const card = new MarvinImage(len, len);
              Marvin.crop(originalCrop, card, x, y, len, len);
              // Marvin.crop(scaled, card, x, y, len, len);
              cardThumbnails.push(card);

              // card.draw(canvasRef.current!, x, y, null);
              const cropped = new MarvinImage();
              Marvin.crop(
                card,
                cropped,
                Math.floor(len * 0.165),
                Math.floor(len * 0.165),
                Math.floor(len * 0.445),
                Math.floor(len * 0.445)
              );
              // cropped.draw(canvasRef.current!, x, y, null);
              Marvin.scale(cropped.clone(), cropped, 32, 32);
              Marvin.grayScale(cropped.clone(), cropped);
              const hashed = hash(cropped.data, 32).join("");
              cardHashes.push(hashed);

              const levelText = new MarvinImage();
              Marvin.crop(card, levelText, 3, len - 27, len - 50, 27);
              Marvin.blackAndWhite(levelText.clone(), levelText, 10);
              Marvin.invertColors(levelText.clone(), levelText);
              cardLevels.push(levelText);

              const masterRank = new MarvinImage();
              Marvin.crop(card, masterRank, len - 36, len - 36, 26, 26);
              Marvin.blackAndWhite(masterRank.clone(), masterRank, 10);
              Marvin.invertColors(masterRank.clone(), masterRank);
              cardMasterRanks.push(masterRank);
              // Marvin.crop(card.clone(), card, len - 36, len - 36, 26, 26);
            });
          });

          // console.log(cardThumbnails);

          const cardDataURLs: string[] = [];
          for (let card of cardThumbnails) {
            // create pseudo canvas
            const _canvas = document.createElement("canvas");
            _canvas.width = card.getWidth();
            _canvas.height = card.getHeight();
            const _context = _canvas.getContext("2d");
            _context?.putImageData(card.loadImageData(), 0, 0);
            cardDataURLs.push(_canvas.toDataURL());
          }

          const { data: charaHash } = await axios.get<[string, string][]>(
            `${process.env.REACT_APP_ASSET_DOMAIN_MINIO}/sekai-best-assets/chara_hash.json`
          );

          // match hash
          const hashResults: [string, number][][] = [];
          cardHashes.forEach((hashValue) => {
            const mapped: [string, number][] = charaHash.map((ch) => [
              ch[0],
              distance(ch[1], hashValue),
            ]);
            const matched = mapped
              .filter((m) => m[1] <= 16)
              .sort((a, b) => a[1] - b[1]);
            hashResults.push(
              matched.length
                ? matched[0][1] <= 10
                  ? matched.slice(0, 1)
                  : matched
                : [["", 64]]
            );
          });

          // console.log(hashResults);

          let ocrLevelResults: string[] = [];
          let ocrMasterRankResults: string[] = [];
          if (ocrEnable) {
            const workers = Array.from({ length: 4 }).map(() => createWorker());
            const scheduler = createScheduler();
            for (let worker of workers) {
              await worker.load();
              await worker.loadLanguage("eng");
              await worker.initialize("eng");
              scheduler.addWorker(worker);
            }

            const levelResults = await Promise.all(
              cardLevels.map((levelText) => {
                // create pseudo canvas
                const _canvas = document.createElement("canvas");
                _canvas.width = levelText.getWidth();
                _canvas.height = levelText.getHeight();
                const _context = _canvas.getContext("2d");
                _context?.putImageData(levelText.loadImageData(), 0, 0);
                return scheduler.addJob("recognize", _canvas.toDataURL());
              })
            );
            ocrLevelResults = levelResults.map((r) => r.data.text);

            const mrResults = await Promise.all(
              cardMasterRanks.map((mrText) => {
                // create pseudo canvas
                const _canvas = document.createElement("canvas");
                _canvas.width = mrText.getWidth();
                _canvas.height = mrText.getHeight();
                const _context = _canvas.getContext("2d");
                _context?.putImageData(mrText.loadImageData(), 0, 0);
                return scheduler.addJob("recognize", _canvas.toDataURL());
              })
            );
            ocrMasterRankResults = mrResults.map((r) => r.data.text);

            scheduler.terminate();
          }
          // console.log(ocrLevelResults);
          // console.log(ocrMasterRankResults);

          const _rows = cardDataURLs.map((dataURL, idx) => ({
            id: idx + 1,
            crop: dataURL,
            full: hashResults[idx].length
              ? hashResults[idx].map(
                  (result) =>
                    `${process.env.REACT_APP_ASSET_DOMAIN_MINIO}/sekai-assets/thumbnail/chara_rip/${result[0]}`
                )
              : [""],
            hashResults: hashResults[idx],
            distances: hashResults[idx].length
              ? hashResults[idx].map((result) => result[1])
              : [0],
            level: ocrLevelResults.length
              ? Number(ocrLevelResults[idx].replace(/\D*(\d{1,2}).*/, "$1")) ||
                1
              : 1,
            masterRank: ocrMasterRankResults.length
              ? Number(ocrMasterRankResults[idx]) || 0
              : 0,
            cardIds: hashResults[idx].length
              ? hashResults[idx].map(
                  (result) =>
                    cards!.find((card) =>
                      result[0].includes(card.assetbundleName)
                    )?.id || -1
                )
              : [-1],
            useIndex: 0,
          }));
          // console.log(_rows);
          setRows(_rows.filter((row) => row.distances[0] !== 64));

          setIsUploading(false);
        });
      }
    },
    [cards, ocrEnable]
  );

  const handleLevelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, row: RowModel) => {
      const { id } = row;
      const idx = rows.findIndex((row) => row.id === id);
      const elem = rows[idx];
      elem.level = Number(e.target.value);

      setRows([...rows.slice(0, idx), elem, ...rows.slice(idx + 1)]);
    },
    [rows]
  );

  const handleMasterRankChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, row: RowModel) => {
      const { id } = row;
      const idx = rows.findIndex((row) => row.id === id);
      const elem = rows[idx];
      elem.masterRank = Number(e.target.value);

      setRows([...rows.slice(0, idx), elem, ...rows.slice(idx + 1)]);
    },
    [rows]
  );

  const handleUseIndexChange = useCallback(
    (newIndex: number, row: RowModel) => {
      const { id } = row;
      const idx = rows.findIndex((row) => row.id === id);
      const elem = rows[idx];
      elem.useIndex = newIndex;

      setRows([...rows.slice(0, idx), elem, ...rows.slice(idx + 1)]);
    },
    [rows]
  );

  const columns = useMemo(
    (): ColDef[] => [
      { field: "id", headerName: "ID", width: 80 },
      {
        field: "crop",
        headerName: t("user:profile.import_card.table.row.cropped_image"),
        width: 100,
        renderCell(params) {
          return (
            <img
              src={params.value as string}
              style={{ height: "64px", width: "64px" }}
              alt=""
            />
          );
        },
        align: "center",
      },
      {
        field: "bestMatch",
        headerName: t("user:profile.import_card.table.row.best_match"),
        width: 100,
        renderCell(params) {
          const idx = params.getValue("useIndex") as number;
          const card = cards?.find(
            (card) => card.id === (params.getValue("cardIds") as number[])[idx]
          )!;
          return card ? (
            <Link
              to={`/card/${card.id}`}
              target="_blank"
              className={interactiveClasses.noDecoration}
            >
              <Grid container direction="column" alignItems="center">
                <img
                  src={(params.getValue("full") as string[])[idx]}
                  style={{ height: "64px", width: "64px" }}
                  alt={`${(
                    (1 - (params.getValue("distances") as number[])[idx] / 64) *
                    100
                  ).toFixed(1)}%`}
                />
                <Typography>{`${(
                  (1 - (params.getValue("distances") as number[])[idx] / 64) *
                  100
                ).toFixed(1)}%`}</Typography>
              </Grid>
            </Link>
          ) : (
            <Fragment></Fragment>
          );
        },
        align: "center",
      },
      {
        field: "level",
        headerName: t("user:profile.import_card.table.row.card_level"),
        width: 150,
        renderCell(params) {
          return (
            <Input
              value={params.value as string}
              type="number"
              inputMode="numeric"
              inputProps={{
                min: 1,
                max: 60,
              }}
              onChange={(e) =>
                handleLevelChange(
                  e as React.ChangeEvent<HTMLInputElement>,
                  params.row
                )
              }
            />
          );
        },
      },
      {
        field: "masterRank",
        headerName: t("user:profile.import_card.table.row.card_master_rank"),
        width: 150,
        renderCell(params) {
          return (
            <Input
              value={params.value as string}
              type="number"
              inputMode="numeric"
              inputProps={{
                min: 0,
                max: 5,
              }}
              onChange={(e) =>
                handleMasterRankChange(
                  e as React.ChangeEvent<HTMLInputElement>,
                  params.row
                )
              }
            />
          );
        },
      },
      {
        field: "changeCard",
        headerName: t(
          "user:profile.import_card.table.row.other_possible_result"
        ),
        width:
          100 *
          (Math.max(...rows.map((row) => row.hashResults.length)) - 1 || 0),
        renderCell(params) {
          const useIdx = params.getValue("useIndex") as number;
          return (
            <Grid container spacing={1}>
              {Array.from({
                length: (params.getValue("distances") as number[]).length,
              })
                .map((_, idx) => idx)
                .filter((idx) => idx !== useIdx)
                .map((idx) => (
                  <Grid item key={idx}>
                    <Grid container direction="column" alignItems="center">
                      <img
                        src={(params.getValue("full") as string[])[idx]}
                        style={{
                          height: "64px",
                          width: "64px",
                          cursor: "pointer",
                        }}
                        alt={`${(
                          (1 -
                            (params.getValue("distances") as number[])[idx] /
                              64) *
                          100
                        ).toFixed(1)}%`}
                        onClick={() => handleUseIndexChange(idx, params.row)}
                      />
                      <Typography>{`${(
                        (1 -
                          (params.getValue("distances") as number[])[idx] /
                            64) *
                        100
                      ).toFixed(1)}%`}</Typography>
                    </Grid>
                  </Grid>
                ))}
            </Grid>
          );
        },
      },
    ],
    [
      cards,
      handleLevelChange,
      handleMasterRankChange,
      handleUseIndexChange,
      interactiveClasses.noDecoration,
      rows,
      t,
    ]
  );

  const handleSubmitCardList = useCallback(async () => {
    setPostingCardList(true);
    try {
      const cardList = rows
        .map((row) => ({
          cardId: row.cardIds[row.useIndex],
          level: row.level,
          masterRank: row.masterRank,
        }))
        .sort((a, b) => a.cardId - b.cardId);

      await postSekaiCardList(sekaiProfile!.id, cardList);

      updateSekaiProfile(
        Object.assign({}, sekaiProfile, {
          cardList,
        })
      );

      setSuccessMsg(t("user:profile.import_card.submit_success"));
      setIsSuccess(true);
    } catch (error) {
      setErrMsg(t("user:profile.import_card.submit_error"));
      setIsError(true);
    }
    setPostingCardList(false);
  }, [postSekaiCardList, rows, sekaiProfile, t, updateSekaiProfile]);

  return (
    <Fragment>
      <Grid container spacing={1}>
        <Grid item xs={12}>
          <Grid container>
            <input
              accept="image/png,image/jpeg"
              className={interactiveClasses.inputHidden}
              id="upload-member-button"
              type="file"
              onChange={(e) => {
                if (!e.target.files || !e.target.files.length) return;
                const file = e.target.files.item(0);
                if (!file?.type.startsWith("image/")) return;

                const reader = new FileReader();

                reader.onload = onReaderLoad;

                reader.readAsDataURL(file);

                e.target.value = "";
              }}
              disabled={isUploading || !cards || !cards.length}
            />
            <label htmlFor="upload-member-button">
              <Grid container alignItems="center" spacing={1}>
                <Grid item>
                  <Button
                    variant="outlined"
                    component="span"
                    disabled={isUploading || !cards || !cards.length}
                    startIcon={
                      isUploading ? <CircularProgress size={24} /> : <Upload />
                    }
                  >
                    {t("user:profile.import_card.import_button")}
                  </Button>
                </Grid>
              </Grid>
            </label>
          </Grid>
        </Grid>
        {/* <Grid item container>
        <Grid item xs={12}>
          <canvas ref={canvasRef} style={{ width: "100%" }}></canvas>
        </Grid>
      </Grid> */}
        <Grid item xs={12}>
          <Grid container>
            <Grid item>
              <Tooltip
                title={t(
                  "user:profile.import_card.enable_ocr_tooltip"
                ).toString()}
                arrow
              >
                <FormControl>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={ocrEnable}
                        onChange={(ev) => setOcrEnabled(ev.target.checked)}
                      />
                    }
                    label={t("user:profile.import_card.enable_ocr")}
                  />
                </FormControl>
              </Tooltip>
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12}>
          <Grid container>
            <Grid item xs={12} style={{ height: "600px" }}>
              <DataGrid
                columns={columns}
                rows={rows}
                disableColumnFilter
                disableColumnReorder
                disableColumnMenu
                disableSelectionOnClick
                rowHeight={100}
                pageSize={100}
              />
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12}>
          <Button
            variant="contained"
            color="primary"
            disabled={!rows.length || postingCardList}
            onClick={handleSubmitCardList}
            fullWidth
            startIcon={postingCardList && <CircularProgress size={24} />}
          >
            {t("common:submit")}
          </Button>
        </Grid>
      </Grid>
      <Snackbar
        open={isError}
        autoHideDuration={3000}
        onClose={() => {
          setIsError(false);
        }}
      >
        <Alert
          onClose={() => {
            setIsError(false);
          }}
          severity="error"
        >
          {errMsg}
        </Alert>
      </Snackbar>
      <Snackbar
        open={isSuccess}
        autoHideDuration={3000}
        onClose={() => {
          setIsSuccess(false);
        }}
      >
        <Alert
          onClose={() => {
            setIsSuccess(false);
          }}
          severity="success"
        >
          {successMsg}
        </Alert>
      </Snackbar>
    </Fragment>
  );
};

export default SekaiUserImportMember;
