import { Storage } from "@plasmohq/storage"

export const localStorage = new Storage({
    area: "local"
})


export const syncStorage = new Storage({
    area: "sync"
})

