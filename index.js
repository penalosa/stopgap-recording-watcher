const https = require("https")
const fs = require("fs")
const fetch = require("node-fetch")
let stream = fs.createWriteStream("./recording.mp3")
let info = {}
const moment = require("moment")
const s3 = require("s3")
let uploadQueue = []
const secrets = require("./secrets/secrets")
let client = s3.createClient({
    s3Options: {
        ...secrets,
        endpoint: `nyc3.digitaloceanspaces.com`
    }
})
const find = (ident, name) => {
    return new Promise((yes, no) => {
        let params = {
            s3Params: {
                Bucket: "freshair",
                Prefix: `recordings/${ident}/`
            }
        }
        var lister = client.listObjects(params)
        lister.on("error", function(err) {
            no(err)
        })
        lister.on("data", function(data) {
            yes(
                !!data.Contents.find(
                    i => i.Key == `recordings/${ident}/${name}`
                )
            )
        })
    })
}
const upload = async (file, ident, name) => {
    return new Promise((yes, no) => {
        let key = `recordings/${ident}/${name}`

        let params = {
            localFile: file,

            s3Params: {
                ACL: "public-read",
                Bucket: "freshair",
                Key: key
            }
        }
        find(ident, name).then(found => {
            if (!found) {
                let uploader = client.uploadFile(params)
                uploader.on("end", () => {
                    yes()
                })
                uploader.on("error", err => {
                    no(err)
                })
            } else {
                yes()
            }
        })
    })
}
let lastFile = null
let lastStream = null
const checkDetails = res => async () => {
    let details = await fetch(
        "https://freshair.org.uk/api/broadcast_info"
    ).then(r => r.json())
    if (details.ident != info.ident) {
        console.log("changed", lastFile)
        await fs.promises.mkdir(`./recordings/${details.ident}`, {
            recursive: true
        })
        const path = `./recordings/${details.ident}/${moment().format(
            "ddd Do MMM, HH:mm:ss"
        )}.mp3`
        let stream = fs.createWriteStream(path)
        if (lastStream) lastStream.end()
        lastStream = res.pipe(stream)

        if (lastFile) uploadQueue.push(lastFile)
        lastFile = path

        info = { ...details }
        return
    }
    info = { ...details }
}
const doUpload = async () => {
    if (uploadQueue.length > 0) {
        console.log(uploadQueue.length, "files to upload...", uploadQueue)

        let file = uploadQueue.shift()
        let [dot, rec, ident, time] = file.split("/")
        try {
            await upload(file, ident, time)
            console.log("Uploaded", file)
            await fs.promises.unlink(file)
        } catch (e) {
            console.error("Failed", file, e)
            uploadQueue.push(file)
        }
    }
}
setInterval(doUpload, 3000)

https
    .get("https://radio.freshair.org.uk/radio", res => {
        console.log("statusCode:", res.statusCode)
        console.log("headers:", res.headers)
        setInterval(checkDetails(res), 3000)
    })
    .on("error", e => {
        console.error(e)
    })
