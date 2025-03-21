import { Logger } from "@medusajs/framework/types"
import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"
import RedisEventBusService from "../event-bus-redis"

// const redisURL = "redis://localhost:6379"
// const client = new Redis(6379, redisURL, {
//   // Lazy connect to properly handle connection errors
//   lazyConnect: true,
//   maxRetriesPerRequest: 0,
// })

jest.genMockFromModule("bullmq")
jest.genMockFromModule("ioredis")
jest.mock("bullmq")
jest.mock("ioredis")

const loggerMock = {
  info: jest.fn().mockImplementation(console.log),
  warn: jest.fn().mockImplementation(console.warn),
  error: jest.fn().mockImplementation(console.error),
} as unknown as Logger

const redisMock = {
  del: () => jest.fn(),
  rpush: () => jest.fn(),
  lrange: () => jest.fn(),
  disconnect: () => jest.fn(),
  expire: () => jest.fn(),
  unlink: () => jest.fn(),
} as unknown as Redis

const simpleModuleOptions = { redisUrl: "test-url" }
const moduleDeps = {
  logger: loggerMock,
  eventBusRedisConnection: redisMock,
}

describe("RedisEventBusService", () => {
  let eventBus: RedisEventBusService
  let queue
  let redis

  describe("constructor", () => {
    beforeEach(async () => {
      jest.clearAllMocks()

      eventBus = new RedisEventBusService(moduleDeps, simpleModuleOptions, {
        scope: "internal",
      })
    })

    it("Creates a queue + worker", () => {
      expect(Queue).toHaveBeenCalledTimes(1)
      expect(Queue).toHaveBeenCalledWith("events-queue", {
        connection: expect.any(Object),
        prefix: "RedisEventBusService",
      })

      expect(Worker).toHaveBeenCalledTimes(1)
      expect(Worker).toHaveBeenCalledWith(
        "events-queue",
        expect.any(Function),
        {
          connection: expect.any(Object),
          prefix: "RedisEventBusService",
          autorun: false,
        }
      )
    })

    it("Throws on isolated module declaration", () => {
      try {
        eventBus = new RedisEventBusService(moduleDeps, simpleModuleOptions, {
          scope: "internal",
        })
      } catch (error) {
        expect(error.message).toEqual(
          "At the moment this module can only be used with shared resources"
        )
      }
    })
  })

  describe("emit", () => {
    describe("Successfully emits events", () => {
      beforeEach(async () => {
        jest.clearAllMocks()

        eventBus = new RedisEventBusService(moduleDeps, simpleModuleOptions, {
          scope: "internal",
        })

        queue = (eventBus as any).queue_
        queue.addBulk = jest.fn()
        redis = (eventBus as any).eventBusRedisConnection_
        redis.rpush = jest.fn()
      })

      it("should add job to queue with default options", async () => {
        await eventBus.emit([
          {
            name: "eventName",
            data: {
              hi: "1234",
            },
          },
        ])

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([
          {
            name: "eventName",
            data: { data: { hi: "1234" } },
            opts: {
              attempts: 1,
              removeOnComplete: true,
            },
          },
        ])
      })

      it("should add job to queue with custom options passed directly upon emitting", async () => {
        await eventBus.emit([{ name: "eventName", data: { hi: "1234" } }], {
          attempts: 3,
          backoff: 5000,
          delay: 1000,
        })

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([
          {
            name: "eventName",
            data: { data: { hi: "1234" } },
            opts: {
              attempts: 3,
              backoff: 5000,
              delay: 1000,
              removeOnComplete: true,
            },
          },
        ])
      })

      it("should add job to queue with module job options", async () => {
        eventBus = new RedisEventBusService(
          moduleDeps,
          {
            ...simpleModuleOptions,
            jobOptions: {
              removeOnComplete: { age: 5 },
              attempts: 7,
            },
          },
          {
            scope: "internal",
          }
        )

        queue = (eventBus as any).queue_
        queue.addBulk = jest.fn()

        await eventBus.emit(
          [
            {
              name: "eventName",
              data: { hi: "1234" },
            },
          ],
          { attempts: 3, backoff: 5000, delay: 1000 }
        )

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([
          {
            name: "eventName",
            data: { data: { hi: "1234" } },
            opts: {
              attempts: 3,
              backoff: 5000,
              delay: 1000,
              removeOnComplete: {
                age: 5,
              },
            },
          },
        ])
      })

      it("should add job to queue with default, local, and global options merged", async () => {
        eventBus = new RedisEventBusService(
          moduleDeps,
          {
            ...simpleModuleOptions,
            jobOptions: {
              removeOnComplete: 5,
            },
          },
          {
            scope: "internal",
          }
        )

        queue = (eventBus as any).queue_
        queue.addBulk = jest.fn()

        await eventBus.emit(
          {
            name: "eventName",
            data: { hi: "1234" },
          },
          { delay: 1000 }
        )

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([
          {
            name: "eventName",
            data: { data: { hi: "1234" } },
            opts: {
              attempts: 1,
              removeOnComplete: 5,
              delay: 1000,
            },
          },
        ])
      })

      it("should successfully group events", async () => {
        const options = { delay: 1000 }
        const event = {
          name: "eventName",
          data: { hi: "1234" },
          metadata: { eventGroupId: "test-group-1" },
        }

        const [builtEvent] = (eventBus as any).buildEvents([event], options)

        await eventBus.emit(event, options)

        expect(queue.addBulk).toHaveBeenCalledTimes(0)
        expect(redis.rpush).toHaveBeenCalledTimes(1)
        expect(redis.rpush).toHaveBeenCalledWith(
          "staging:test-group-1",
          JSON.stringify(builtEvent)
        )
      })

      it("should successfully group, release and clear events", async () => {
        const options = { delay: 1000 }
        const events = [
          {
            name: "grouped-event-1",
            data: { hi: "1234" },
            metadata: { eventGroupId: "test-group-1" },
          },
          {
            name: "ungrouped-event-2",
            data: { hi: "1234" },
          },
          {
            name: "grouped-event-2",
            data: { hi: "1234" },
            metadata: { eventGroupId: "test-group-2" },
          },
          {
            name: "grouped-event-3",
            data: { hi: "1235" },
            metadata: { eventGroupId: "test-group-2" },
          },
        ]

        redis.unlink = jest.fn()

        await eventBus.emit(events, options)

        // Expect 1 event to have been send
        // Expect 2 pushes to redis as there are 2 groups of events to push
        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(redis.rpush).toHaveBeenCalledTimes(2)
        expect(redis.unlink).not.toHaveBeenCalled()

        const [testGroup1Event] = (eventBus as any).buildEvents(
          [events[0]],
          options
        )
        const [testGroup2Event] = (eventBus as any).buildEvents(
          [events[2]],
          options
        )
        const [testGroup2Event2] = (eventBus as any).buildEvents(
          [events[3]],
          options
        )

        redis.lrange = jest.fn((key) => {
          if (key === "staging:test-group-1") {
            return Promise.resolve([JSON.stringify(testGroup1Event)])
          }

          if (key === "staging:test-group-2") {
            return Promise.resolve([
              JSON.stringify(testGroup2Event),
              JSON.stringify(testGroup2Event2),
            ])
          }

          return
        })

        queue = (eventBus as any).queue_
        queue.addBulk = jest.fn()

        await eventBus.releaseGroupedEvents("test-group-1")

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([testGroup1Event])
        expect(redis.unlink).toHaveBeenCalledTimes(1)
        expect(redis.unlink).toHaveBeenCalledWith("staging:test-group-1")

        queue = (eventBus as any).queue_
        queue.addBulk = jest.fn()
        redis.unlink = jest.fn()

        await eventBus.releaseGroupedEvents("test-group-2")

        expect(queue.addBulk).toHaveBeenCalledTimes(1)
        expect(queue.addBulk).toHaveBeenCalledWith([
          testGroup2Event,
          testGroup2Event2,
        ])
        expect(redis.unlink).toHaveBeenCalledTimes(1)
        expect(redis.unlink).toHaveBeenCalledWith("staging:test-group-2")
      })
    })
  })

  describe("worker_", () => {
    describe("Successfully processes the jobs", () => {
      beforeEach(async () => {
        jest.clearAllMocks()

        eventBus = new RedisEventBusService(moduleDeps, simpleModuleOptions, {
          scope: "internal",
        })
      })

      it("should process a simple event with no options", async () => {
        const test: string[] = []

        eventBus.subscribe("eventName", () => {
          test.push("success")

          return Promise.resolve()
        })

        // TODO: The typing for this is all over the place
        await eventBus.worker_({
          name: "eventName",
          data: { data: { test: 1 } },
          opts: { attempts: 1 },
        } as any)

        expect(loggerMock.info).toHaveBeenCalledTimes(1)
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Processing eventName which has 1 subscribers"
        )

        expect(test).toEqual(["success"])
      })

      it("should process event with failing subscribers", async () => {
        const test: string[] = []

        eventBus.subscribe("eventName", () => {
          test.push("hi")
          return Promise.resolve()
        })
        eventBus.subscribe("eventName", () => {
          test.push("fail1")
          throw new Error("fail1")
        })
        eventBus.subscribe("eventName", () => {
          test.push("hi2")
          return Promise.resolve()
        })
        eventBus.subscribe("eventName", () => {
          test.push("fail2")
          return Promise.reject("fail2")
        })

        await eventBus.worker_({
          name: "eventName",
          data: { data: { test: 1 } },
          opts: { attempts: 1 },
          update: (data) => data,
        } as any)

        expect(loggerMock.info).toHaveBeenCalledTimes(1)
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Processing eventName which has 4 subscribers"
        )

        expect(loggerMock.warn).toHaveBeenCalledTimes(5)
        expect(loggerMock.warn).toHaveBeenNthCalledWith(
          1,
          "An error occurred while processing eventName:"
        )
        expect(loggerMock.warn).toHaveBeenNthCalledWith(2, new Error("fail1"))

        expect(loggerMock.warn).toHaveBeenNthCalledWith(
          3,
          "An error occurred while processing eventName:"
        )
        expect(loggerMock.warn).toHaveBeenNthCalledWith(4, "fail2")

        expect(loggerMock.warn).toHaveBeenNthCalledWith(
          5,
          "One or more subscribers of eventName failed. Retrying is not configured. Use 'attempts' option when emitting events."
        )

        expect(test.sort()).toEqual(["hi", "fail1", "hi2", "fail2"].sort())
      })

      it("should retry processing when subcribers fail, if configured - final attempt", async () => {
        eventBus.subscribe("eventName", async () => await Promise.resolve(), {
          subscriberId: "1",
        })
        eventBus.subscribe(
          "eventName",
          async () => await Promise.reject("fail1"),
          {
            subscriberId: "2",
          }
        )

        await eventBus
          .worker_({
            name: "eventName",
            data: {
              data: {},
              completedSubscriberIds: ["1"],
            },
            attemptsMade: 2,
            update: (data) => data,
            opts: { attempts: 2 },
          } as any)
          .catch((error) => void 0)

        expect(loggerMock.warn).toHaveBeenCalledTimes(2)
        expect(loggerMock.warn).toHaveBeenCalledWith(
          "An error occurred while processing eventName:"
        )
        expect(loggerMock.warn).toHaveBeenCalledWith("fail1")

        expect(loggerMock.info).toHaveBeenCalledTimes(2)
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Final retry attempt for eventName"
        )
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Retrying eventName which has 2 subscribers (1 of them failed)"
        )
      })

      it("should retry processing when subcribers fail, if configured", async () => {
        eventBus.subscribe("eventName", async () => await Promise.resolve(), {
          subscriberId: "1",
        })
        eventBus.subscribe(
          "eventName",
          async () => await Promise.reject("fail1"),
          {
            subscriberId: "2",
          }
        )

        await eventBus
          .worker_({
            name: "eventName",
            data: {
              data: {},
              completedSubscriberIds: ["1"],
            },
            attemptsMade: 2,
            updateData: (data) => data,
            opts: { attempts: 3 },
          } as any)
          .catch((err) => void 0)

        expect(loggerMock.warn).toHaveBeenCalledTimes(3)
        expect(loggerMock.warn).toHaveBeenCalledWith(
          "An error occurred while processing eventName:"
        )
        expect(loggerMock.warn).toHaveBeenCalledWith("fail1")

        expect(loggerMock.warn).toHaveBeenCalledWith(
          "One or more subscribers of eventName failed. Retrying..."
        )

        expect(loggerMock.info).toHaveBeenCalledTimes(1)
        expect(loggerMock.info).toHaveBeenCalledWith(
          "Retrying eventName which has 2 subscribers (1 of them failed)"
        )
      })
    })
  })
})
